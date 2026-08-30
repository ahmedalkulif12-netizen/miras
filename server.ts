import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';
import axios from 'axios';
import {
  loadServerEnv,
  getServerConfig,
  assertProductionSecrets,
  assertMoyasarConfigured,
} from './server/config/env.ts';
import { verifyFirebaseToken, type AuthenticatedRequest } from './server/middleware/verifyFirebaseToken.ts';
import { verifyAppCheck } from './server/middleware/verifyAppCheck.ts';
import {
  captureRawBody,
  verifyMoyasarWebhookSignature,
  type MoyasarWebhookRequest,
} from './server/middleware/moyasarWebhook.ts';
import { executeCapturePayment } from './server/lib/capturePayment.ts';
import { executeCompleteOrder } from './server/lib/completeOrder.ts';
import { createPricingService } from './server/lib/pricingService.ts';
import {
  firestorePricingDoc,
  PRICING_SEED_SERVICES,
} from './src/lib/pricingDefaults.ts';
import {
  createCheckoutDraft,
  finalizeOrderFromCheckoutDraft,
  publishAfterLocalCheckout,
} from './server/lib/checkoutDraft.ts';
import {
  executeAcceptOrder,
  executeTransitionOrder,
  executePaymentAuthorizedToBroadcasting,
} from './server/lib/acceptOrder.ts';
import { verifyApprovedDriverAccess } from './server/lib/driverAuth.ts';
import { executeDeleteAccount } from './server/lib/deleteAccount.ts';
import {
  clearAdminCustomClaims,
  getAuthUserPhone,
  grantAdminCustomClaims,
  isAuthorizedAdminPhone,
  resolveAdminRecordForSession,
  revokeAdminCustomClaims,
  verifyAdminAccess,
} from './server/lib/adminAcl.ts';
import { verifyPaymentReturnStatus } from './server/lib/paymentReturn.ts';
import {
  finalizePaidCheckoutReturn,
  isMoyasarTestSecret,
} from './server/lib/finalizePaidCheckout.ts';
import {
  isDemoMoyasarId,
  resolveMoyasarCallbackUrl,
} from './server/lib/moyasarCallback.ts';
import { verifyAdmin } from './server/middleware/verifyAdmin.ts';
import { getAdminOverview } from './server/lib/adminOverview.ts';
import {
  listAdminDrivers,
  updateAdminDriverStatus,
  updateAdminDriverDocumentExpiries,
  updateAdminFleetVehicleStatus,
} from './server/lib/adminDrivers.ts';
import { listAdminDirectory, getAdminDirectoryEntry } from './server/lib/adminDirectory.ts';
import { upsertPendingDriverRegistration } from './server/lib/driverRegistration.ts';
import {
  decodeKycImage,
  hasCompleteKycDocuments,
  isKycDocKey,
  kycBucketName,
  mergeKycDocument,
  saveKycImageToStorage,
} from './server/lib/kycDocumentStorage.ts';
import {
  listAdminCustomers,
  updateAdminCustomerStatus,
} from './server/lib/adminCustomers.ts';
import { getAdminFinancialLedger } from './server/lib/adminFinancials.ts';
import {
  approveWithdrawal,
  createWithdrawalRequest,
  getDriverBankDetails,
  listWithdrawalsForAdmin,
  listWithdrawalsForDriver,
  rejectWithdrawal,
  saveDriverBankDetails,
} from './server/lib/withdrawals.ts';
import { securityHeaders } from './server/middleware/securityHeaders.ts';
import {
  canUseAdminFirestore,
  initFirebaseAdmin,
  isFirebaseAdminCredentialError,
} from './server/lib/firebaseAdmin.ts';
import {
  isDevBypassBearer,
  publishAfterLocalCheckoutAsUser,
} from './server/lib/userScopedOrderWrite.ts';

async function startServer() {
  loadServerEnv();

  // Render worker (`npm run dev` + MIRAS_PROCESS_ROLE=agents): IMAP/HITL only.
  // Do not boot the payment API or require Moyasar secrets on this process.
  if ((process.env.MIRAS_PROCESS_ROLE || '').trim() === 'agents') {
    const { startAgentRuntime } = await import('./src/agents/whatsapp.js');
    await startAgentRuntime();
    return;
  }

  const config = getServerConfig();
  try {
    assertProductionSecrets(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const onRender = process.env.RENDER === 'true' || Boolean(process.env.RENDER_SERVICE_ID);
    if (onRender) {
      console.warn(
        `[env] Production secret check failed on Render — continuing boot without payments: ${message}`
      );
    } else {
      throw error;
    }
  }

  const app = express();
  const PORT = Number(process.env.PORT) || config.port || 8080;

  // Required behind reverse proxies (Railway, Cloud Run, nginx) for correct client IP / HTTPS.
  if (config.isProduction) {
    app.set('trust proxy', 1);
    app.use(securityHeaders(true));
  }

  app.get('/health', (_req, res) => {
    res.type('application/json').json({
      ok: true,
      service: 'miras-api',
      env: config.isProduction ? 'production' : 'development',
      deployEnv: config.deployEnv,
      appCheckEnforce: config.appCheckEnforce,
      appUrl: config.appUrl,
    });
  });

  // Never serve HTML for /api — JSON only (Firebase Hosting rewrites + Cloud Run).
  app.use('/api', (_req, res, next) => {
    res.type('application/json');
    next();
  });

  // Moyasar webhook must verify HMAC on raw body — register before global JSON parser
  app.post(
    '/api/webhooks/moyasar',
    express.json({ verify: captureRawBody }),
    verifyMoyasarWebhookSignature,
    async (req: MoyasarWebhookRequest, res: any) => {
      try {
        const payload = req.body;
        const paymentData = payload?.data ?? payload;
        const id = paymentData?.id;
        const status = paymentData?.status;

        if (!id || !status) {
          return res.status(400).json({ error: 'Invalid webhook payload' });
        }

        const eventId = `${id}_${status}`;
        const eventRef = db.collection('webhook_events').doc(eventId);
        const existingEvent = await eventRef.get();
        if (existingEvent.exists) {
          return res.sendStatus(200);
        }

        if (status === 'paid' || status === 'authorized') {
          const paymentsQuery = await db
            .collection('payments')
            .where('transactionId', '==', id)
            .limit(1)
            .get();

          if (!paymentsQuery.empty) {
            const paymentDoc = paymentsQuery.docs[0];
            const paymentData = paymentDoc.data() as Record<string, unknown>;
            let linkedOrderId = paymentData.orderId as string | undefined;
            const draftId = paymentData.draftId as string | undefined;
            const paymentUserId = paymentData.userId as string | undefined;

            await db.runTransaction(async (transaction) => {
              transaction.set(eventRef, {
                transactionId: id,
                status,
                processedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              transaction.update(paymentDoc.ref, {
                status: 'authorized',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            });

            // Finalize draft → orders/{id} broadcasting only after payment success.
            if ((!linkedOrderId || linkedOrderId === 'pending') && draftId && paymentUserId) {
              try {
                const finalized = await finalizeOrderFromCheckoutDraft(db, {
                  userId: paymentUserId,
                  draftId,
                  paymentId: paymentDoc.id,
                  moyasarId: id,
                  testMode: isMoyasarTestSecret(config.moyasarSecretKey),
                });
                linkedOrderId = finalized.orderId;
                await paymentDoc.ref.set(
                  { orderId: linkedOrderId, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
                  { merge: true }
                );
              } catch (finalizeErr) {
                console.error('Finalize order from draft failed:', finalizeErr);
              }
            } else if (linkedOrderId && linkedOrderId !== 'pending') {
              await executePaymentAuthorizedToBroadcasting(db, linkedOrderId);
            }
            console.log(`Payment ${id} verified and order broadcast triggered.`);
          } else {
            await eventRef.set({
              transactionId: id,
              status,
              processedAt: admin.firestore.FieldValue.serverTimestamp(),
              note: 'payment_doc_not_found',
            });
          }
        } else {
          await eventRef.set({
            transactionId: id,
            status,
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
            note: 'ignored_status',
          });
        }

        res.sendStatus(200);
      } catch (error) {
        console.error('Webhook error:', error);
        res.sendStatus(500);
      }
    }
  );

  app.use(express.json({ limit: '8mb' }));

  // Initialize Firebase Admin with service-account env/file, Cloud Run ADC, or project-only (local).
  initFirebaseAdmin(config.firebaseProjectId);
  const db = admin.firestore();
  const pricingService = createPricingService(db);

  // Seed missing pricing/{service} docs when Admin credentials exist.
  // Local `npm run dev` usually has no service account — quotes use built-in defaults instead.
  async function seedPricing() {
    if (!canUseAdminFirestore()) {
      console.info(
        '[pricing] Skip Firestore seed (no Admin credentials). Built-in rates will be used until pricing/{service} docs exist.'
      );
      return;
    }

    try {
      for (const service of PRICING_SEED_SERVICES) {
        const docRef = db.collection('pricing').doc(service);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
          const payload = firestorePricingDoc(service === 'default' ? 'flatbed' : service);
          await docRef.set(payload);
          console.info(`[pricing] Seeded pricing/${service}`);
        }
      }
    } catch (error) {
      console.warn('[pricing] Seed skipped — quotes will use built-in defaults:', error);
    }
  }

  // Run seed check
  seedPricing();
  
  const MOYASAR_API_URL = 'https://api.moyasar.com/v1';

  // Authenticated APIs also accept App Check tokens (enforced when APP_CHECK_ENFORCE=true).
  const secureApi = [verifyAppCheck(), verifyFirebaseToken()];
  const adminApi = [...secureApi, verifyAdmin(db, admin.auth())];

  // Moyasar return verification — authenticated customer only (callback landing).
  // Accepts draftId (pre-payment) or orderId (legacy); finalizes order only after paid.
  app.get('/api/payments/return', ...secureApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      const draftId = String(req.query.draftId || '');
      const orderId = String(req.query.orderId || '');
      if (!draftId && !orderId) {
        return res.status(400).json({ error: 'draftId or orderId is required' });
      }

      const moyasarId = req.query.moyasarId ? String(req.query.moyasarId) : undefined;
      const returnStatus = req.query.status ? String(req.query.status) : undefined;
      const uid = req.firebaseUid!;

      if (returnStatus && ['failed', 'voided', 'cancelled'].includes(returnStatus.toLowerCase())) {
        return res.json({
          success: false,
          orderId: orderId || draftId,
          paymentStatus: 'failed',
          orderStatus: 'awaiting_payment',
          startTracking: false,
          message: 'Payment was not completed',
        });
      }

      // Finalize unpaid checkout draft after Moyasar paid (including test keys).
      if (draftId) {
        if (!moyasarId) {
          return res.status(400).json({
            error: 'moyasarId is required to finalize a checkout draft',
          });
        }

        if (isDemoMoyasarId(moyasarId)) {
          if (config.deployEnv !== 'development') {
            return res.status(403).json({
              error: 'Demo checkout is disabled in this environment',
            });
          }
          const published = await publishAfterLocalCheckout(db, {
            userId: uid,
            draftId,
            moyasarId,
            testMode: true,
          });
          return res.json({
            success: true,
            orderId: published.orderId,
            paymentStatus: 'authorized',
            orderStatus: published.status,
            startTracking: true,
            testMode: true,
          });
        }

        const finalized = await finalizePaidCheckoutReturn(db, {
          uid,
          draftId,
          moyasarId,
          returnStatus,
          moyasarSecretKey: config.moyasarSecretKey,
        });
        return res.json(finalized);
      }

      const result = await verifyPaymentReturnStatus(db, {
        uid,
        orderId,
        moyasarId,
        returnStatus,
      });

      res.json(result);
    } catch (error: any) {
      console.error('Payment return verification error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to verify payment return',
      });
    }
  });

  // Pre-payment checkout draft — NOT written to `orders` (drivers never see it).
  app.post('/api/checkout-draft', ...secureApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      const userId = req.firebaseUid!;
      const result = await createCheckoutDraft(db, pricingService, userId, req.body);
      res.status(201).json(result);
    } catch (error: any) {
      console.error('Checkout draft error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to prepare checkout draft',
      });
    }
  });

  /**
   * After local/demo payment gateway confirm — write live `orders` as broadcasting
   * with canonical serviceType (Admin SDK). Used by /payment-checkout; real Moyasar
   * still finalizes via webhook + GET /api/payments/return.
   */
  app.post(
    '/api/orders/publish-after-checkout',
    ...secureApi,
    async (req: AuthenticatedRequest, res: any) => {
      const userId = req.firebaseUid!;
      const draftId = String(req.body?.draftId || '');
      const moyasarId = req.body?.moyasarId
        ? String(req.body.moyasarId)
        : undefined;
      const payload = req.body?.payload;
      const financials = req.body?.financials;
      const testMode =
        isMoyasarTestSecret(config.moyasarSecretKey) ||
        Boolean(moyasarId && moyasarId.startsWith('demo-'));

      if (!draftId) {
        return res.status(400).json({ error: 'draftId is required' });
      }

      if (config.deployEnv !== 'development' && isDemoMoyasarId(moyasarId)) {
        return res.status(403).json({
          error: 'Demo checkout is disabled in this environment',
        });
      }

      const lockedPublish = config.deployEnv !== 'development';
      const clientWriteResponse = (orderId: string, reason: string) => {
        if (lockedPublish) {
          return res.status(503).json({
            error: 'Order publish requires Admin SDK in staging/production',
            code: 'ADMIN_SDK_REQUIRED',
          });
        }
        return res.json({
          success: true,
          clientWriteRequired: true,
          orderId,
          paymentStatus: 'authorized',
          orderStatus: 'broadcasting',
          startTracking: true,
          message: reason,
        });
      };

      const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();

      try {
        if (!canUseAdminFirestore()) {
          if (!lockedPublish && bearer && !isDevBypassBearer(bearer)) {
            try {
              const published = await publishAfterLocalCheckoutAsUser({
                projectId: config.firebaseProjectId,
                idToken: bearer,
                userId,
                draftId,
                moyasarId,
                payload,
                financials,
                testMode,
              });
              return res.json({
                success: true,
                orderId: published.orderId,
                paymentStatus: 'authorized',
                orderStatus: published.status,
                startTracking: true,
                message: 'Order published for drivers',
              });
            } catch (userWriteError) {
              console.warn(
                '[orders] User-token Firestore write failed — client will write:',
                userWriteError
              );
            }
          }

          return clientWriteResponse(
            draftId,
            'Local Admin credentials unavailable - client will write the order'
          );
        }

        const published = await publishAfterLocalCheckout(db, {
          userId,
          draftId,
          moyasarId,
          payload,
          financials,
          testMode,
        });

        return res.json({
          success: true,
          orderId: published.orderId,
          paymentStatus: 'authorized',
          orderStatus: published.status,
          startTracking: true,
          message: 'Order published for drivers',
        });
      } catch (error: any) {
        console.error('Publish after checkout error:', error);
        if (isFirebaseAdminCredentialError(error) || !canUseAdminFirestore()) {
          return clientWriteResponse(
            draftId,
            'Local Admin credentials unavailable - client will write the order'
          );
        }
        res.status(error?.statusCode ?? 500).json({
          error: error?.message || 'Failed to publish order after checkout',
          code: 'PUBLISH_FAILED',
        });
      }
    }
  );

  // Admin session — ONLY +966541330720 (0541330720). Firestore ACL is best-effort.
  app.post('/api/admin/session', ...secureApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      const uid = req.firebaseUid!;
      const authPhone = await getAuthUserPhone(admin.auth(), uid);

      if (!isAuthorizedAdminPhone(authPhone)) {
        await clearAdminCustomClaims(admin.auth(), uid).catch(() => undefined);
        return res.status(403).json({
          error: 'Not authorized for Miras Admin — access is restricted to the designated admin phone',
        });
      }

      const record =
        (await resolveAdminRecordForSession(db, uid, authPhone)) ||
        ({
          uid,
          name: 'Miras Admin',
          phone: authPhone!,
          active: true,
        } as const);

      await grantAdminCustomClaims(admin.auth(), uid).catch((err) => {
        console.warn('[admin/session] grantAdminCustomClaims soft-fail:', err);
      });

      res.json({
        role: 'admin',
        uid,
        name: record.name,
        phone: record.phone,
      });
    } catch (error: any) {
      console.error('Admin session error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to establish admin session',
      });
    }
  });

  // P0-14: RBAC session — revokes stale admin claims to prevent privilege escalation.
  // Accepts canonical roles + legacy customer/driver aliases.
  app.post('/api/auth/session', ...secureApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      const uid = req.firebaseUid!;
      const rawRole = req.body?.intendedRole as string | undefined;

      type SessionRole = 'b2c_client' | 'b2c_driver' | 'b2b_corporate' | 'b2b_operator';
      const roleAliases: Record<string, SessionRole> = {
        customer: 'b2c_client',
        driver: 'b2c_driver',
        b2c_client: 'b2c_client',
        b2c_driver: 'b2c_driver',
        b2b_corporate: 'b2b_corporate',
        b2b_operator: 'b2b_operator',
      };

      // Firestore users/{uid}.role is authoritative for returning accounts.
      let firestoreRole: SessionRole | undefined;
      try {
        const userSnap = await db.collection('users').doc(uid).get();
        if (userSnap.exists) {
          const raw = String(userSnap.data()?.role || '');
          firestoreRole = roleAliases[raw];
        }
        if (!firestoreRole) {
          const driverSnap = await db.collection('drivers').doc(uid).get();
          if (driverSnap.exists) {
            firestoreRole = 'b2c_driver';
          }
        }
      } catch (err) {
        console.warn('[auth/session] Firestore role lookup failed:', err);
      }

      const intendedRole: SessionRole | undefined =
        firestoreRole || (rawRole ? roleAliases[rawRole] : undefined);
      if (!intendedRole) {
        return res.status(400).json({
          error:
            'intendedRole must be one of: b2c_client, b2c_driver, b2b_corporate, b2b_operator',
        });
      }

      await revokeAdminCustomClaims(admin.auth(), uid, intendedRole);
      res.json({ role: intendedRole, uid, source: firestoreRole ? 'firestore' : 'intended' });
    } catch (error: any) {
      console.error('User session error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to establish user session',
      });
    }
  });

  // P0-14: Admin identity probe — requires claim + admins/{uid} (for dashboard bootstrap).
  app.get('/api/admin/me', ...adminApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      const record = await verifyAdminAccess(db, req.firebaseToken!, admin.auth());
      res.json({ uid: record.uid, name: record.name, role: 'admin', phone: record.phone });
    } catch (error: any) {
      res.status(error?.statusCode ?? 403).json({ error: error?.message || 'Admin access denied' });
    }
  });

  // Admin dashboard metrics — read-only Firestore via Admin SDK.
  app.get('/api/admin/overview', ...adminApi, async (_req: AuthenticatedRequest, res: any) => {
    try {
      const overview = await getAdminOverview(db);
      res.json(overview);
    } catch (error: any) {
      console.error('Admin overview error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to load admin overview',
      });
    }
  });

  app.get('/api/admin/orders', ...adminApi, async (_req: AuthenticatedRequest, res: any) => {
    try {
      const overview = await getAdminOverview(db);
      res.json({
        orders: overview.recentOrders,
        stats: {
          pendingDrivers: overview.stats.pendingDrivers,
          activeTrips: overview.stats.activeTrips,
          completedOrders: overview.stats.completedOrders,
          openOrders: overview.stats.openOrders,
        },
      });
    } catch (error: any) {
      console.error('Admin orders list error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to load admin orders',
      });
    }
  });

  app.get('/api/admin/drivers', ...adminApi, async (_req: AuthenticatedRequest, res: any) => {
    try {
      const drivers = await listAdminDrivers(db);
      res.json({ drivers });
    } catch (error: any) {
      console.error('Admin drivers list error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to load drivers',
      });
    }
  });

  app.get('/api/admin/directory', ...adminApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      const kindRaw = String(req.query.kind || 'all');
      const kind =
        kindRaw === 'b2c_client' ||
        kindRaw === 'b2c_driver' ||
        kindRaw === 'b2b_corporate' ||
        kindRaw === 'b2b_operator' ||
        kindRaw === 'fleet_driver'
          ? kindRaw
          : 'all';
      const directory = await listAdminDirectory(db, kind);
      res.json(directory);
    } catch (error: any) {
      console.error('Admin directory list error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to load user directory',
      });
    }
  });

  app.get('/api/admin/directory/:id', ...adminApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      const entry = await getAdminDirectoryEntry(db, String(req.params.id || ''));
      if (!entry) {
        return res.status(404).json({ error: 'Profile not found' });
      }
      res.json({ entry });
    } catch (error: any) {
      console.error('Admin directory detail error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to load profile',
      });
    }
  });

  /**
   * Authenticated driver self-registration upsert (Admin SDK).
   * Guarantees users/{uid} + drivers/{uid} pending rows exist for the admin queue.
   */
  app.post('/api/drivers/registration', ...secureApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      const uid = req.firebaseUid!;
      const body = (req.body || {}) as Record<string, unknown>;
      const result = await upsertPendingDriverRegistration(db, uid, {
        name: typeof body.name === 'string' ? body.name : undefined,
        phone: typeof body.phone === 'string' ? body.phone : undefined,
        vehicleType: typeof body.vehicleType === 'string' ? body.vehicleType : undefined,
        vehicleOption: typeof body.vehicleOption === 'string' ? body.vehicleOption : undefined,
        plateNumber: typeof body.plateNumber === 'string' ? body.plateNumber : undefined,
        nationalId: typeof body.nationalId === 'string' ? body.nationalId : undefined,
        registrationSerial:
          typeof body.registrationSerial === 'string' ? body.registrationSerial : undefined,
        documentUploadStatuses:
          body.documentUploadStatuses && typeof body.documentUploadStatuses === 'object'
            ? (body.documentUploadStatuses as Record<string, string>)
            : undefined,
        documentExpiries:
          body.documentExpiries && typeof body.documentExpiries === 'object'
            ? (body.documentExpiries as Record<string, string>)
            : undefined,
        documentFiles:
          body.documentFiles && typeof body.documentFiles === 'object'
            ? (body.documentFiles as Record<
                string,
                {
                  status?: string;
                  storagePath?: string;
                  contentType?: string;
                  fileName?: string;
                  uploadedAt?: string;
                }
              >)
            : undefined,
      });
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error('Driver registration upsert error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to submit driver registration',
      });
    }
  });

  /** Upload / replace the authenticated user's profile photo (GCS via Admin SDK). */
  app.post(
    '/api/users/profile-photo',
    ...secureApi,
    async (req: AuthenticatedRequest, res: any) => {
      try {
        const uid = req.firebaseUid!;
        const body = (req.body || {}) as Record<string, unknown>;
        const contentBase64 = typeof body.contentBase64 === 'string' ? body.contentBase64 : '';
        const contentTypeRaw =
          typeof body.contentType === 'string' && body.contentType
            ? body.contentType.toLowerCase()
            : 'image/jpeg';
        const allowedTypes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
        if (!allowedTypes.has(contentTypeRaw)) {
          return res.status(400).json({ error: 'Only JPEG, PNG, or WebP images are allowed' });
        }
        const contentType = contentTypeRaw === 'image/jpg' ? 'image/jpeg' : contentTypeRaw;
        const fileNameRaw =
          typeof body.fileName === 'string' && body.fileName.trim()
            ? body.fileName.trim()
            : 'avatar.jpg';
        const fileName = fileNameRaw.replace(/[^\w.\-()-]+/g, '_').slice(0, 80);

        if (!contentBase64 || contentBase64.length < 16) {
          return res.status(400).json({ error: 'contentBase64 is required' });
        }

        const buffer = Buffer.from(contentBase64, 'base64');
        if (!buffer.length || buffer.length > 3 * 1024 * 1024) {
          return res.status(400).json({ error: 'Image must be between 1 byte and 3 MB' });
        }

        const bucketName =
          process.env.DRIVER_DOCS_BUCKET ||
          process.env.FIREBASE_STORAGE_BUCKET ||
          'hamula-cfc6c-driver-docs';
        const storagePath = `users/${uid}/profile/${Date.now()}_${fileName}`;
        const bucket = admin.storage().bucket(bucketName);
        await bucket.file(storagePath).save(buffer, {
          contentType,
          resumable: false,
          metadata: {
            cacheControl: 'public, max-age=31536000',
            metadata: {
              userId: uid,
              uploadedBy: uid,
              kind: 'profile-photo',
            },
          },
        });

        const [photoURL] = await bucket.file(storagePath).getSignedUrl({
          action: 'read',
          expires: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
          version: 'v4',
        });

        const uploadedAt = new Date().toISOString();
        await db
          .collection('users')
          .doc(uid)
          .set(
            {
              uid,
              photoURL,
              photoStoragePath: storagePath,
              photoUpdatedAt: uploadedAt,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

        res.json({
          photoURL,
          storagePath,
          contentType,
          fileName,
          uploadedAt,
        });
      } catch (error: any) {
        console.error('Profile photo upload error:', error);
        res.status(error?.statusCode ?? 500).json({
          error: error?.message || 'Failed to upload profile photo',
        });
      }
    }
  );

  /** Upload a single KYC document for the authenticated driver (Firebase Storage). */
  app.post(
    '/api/drivers/documents/:docKey',
    ...secureApi,
    async (req: AuthenticatedRequest, res: any) => {
      try {
        const uid = req.firebaseUid!;
        const docKey = String(req.params.docKey || '');
        if (!isKycDocKey(docKey)) {
          return res.status(400).json({ error: 'Invalid document key' });
        }

        const body = (req.body || {}) as Record<string, unknown>;
        const contentBase64 = typeof body.contentBase64 === 'string' ? body.contentBase64 : '';
        const fileNameRaw =
          typeof body.fileName === 'string' && body.fileName.trim()
            ? body.fileName.trim()
            : `${docKey}.jpg`;
        const fileName = fileNameRaw.replace(/[^\w.\-()-]+/g, '_').slice(0, 80);

        if (!contentBase64 || contentBase64.length < 16) {
          return res.status(400).json({ error: 'contentBase64 is required' });
        }

        const decoded = decodeKycImage({
          contentBase64,
          contentType: typeof body.contentType === 'string' ? body.contentType : 'image/jpeg',
        });
        const storagePath = `drivers/${uid}/documents/${docKey}/${Date.now()}_${fileName}`;
        const saved = await saveKycImageToStorage({
          storagePath,
          buffer: decoded.buffer,
          contentType: decoded.contentType,
          metadata: {
            driverId: uid,
            documentKey: docKey,
            uploadedBy: uid,
          },
        });

        const driverRef = db.collection('drivers').doc(uid);
        const driverSnap = await driverRef.get();
        const uploadedAt = new Date().toISOString();
        const docMeta = {
          status: 'uploaded',
          storagePath: saved.storagePath,
          url: saved.url,
          contentType: decoded.contentType,
          fileName,
          uploadedAt,
        };
        const mergedDocs = mergeKycDocument(
          (driverSnap.data()?.documents || {}) as Record<string, unknown>,
          docKey,
          docMeta
        );
        const existingStatus = String(driverSnap.data()?.accountStatus || '');
        const preserveModeration = ['approved', 'rejected', 'suspended', 'banned', 'blocked'].includes(
          existingStatus
        );
        await driverRef.set(
          {
            uid,
            role: 'b2c_driver',
            accountStatus: preserveModeration
              ? existingStatus
              : hasCompleteKycDocuments(mergedDocs)
                ? 'ready_for_review'
                : 'pending',
            documents: {
              [docKey]: docMeta,
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        res.json({
          status: 'uploaded',
          storagePath: saved.storagePath,
          url: saved.url,
          contentType: decoded.contentType,
          fileName,
          uploadedAt,
        });
      } catch (error: any) {
        console.error('Driver document upload error:', error);
        res.status(error?.statusCode ?? 500).json({
          error: error?.message || 'Failed to upload document',
        });
      }
    }
  );

  /** Upload a KYC document for a fleet driver/vehicle owned by the operator. */
  app.post(
    '/api/operators/vehicles/:vehicleId/documents/:docKey',
    ...secureApi,
    async (req: AuthenticatedRequest, res: any) => {
      try {
        const uid = req.firebaseUid!;
        const vehicleId = String(req.params.vehicleId || '');
        const docKey = String(req.params.docKey || '');
        if (!vehicleId || !isKycDocKey(docKey)) {
          return res.status(400).json({ error: 'Invalid vehicle or document key' });
        }

        const vehicleRef = db.collection('operators').doc(uid).collection('vehicles').doc(vehicleId);
        const vehicleSnap = await vehicleRef.get();
        if (!vehicleSnap.exists) {
          return res.status(404).json({ error: 'Vehicle not found' });
        }

        const body = (req.body || {}) as Record<string, unknown>;
        const contentBase64 = typeof body.contentBase64 === 'string' ? body.contentBase64 : '';
        const fileNameRaw =
          typeof body.fileName === 'string' && body.fileName.trim()
            ? body.fileName.trim()
            : `${docKey}.jpg`;
        const fileName = fileNameRaw.replace(/[^\w.\-()-]+/g, '_').slice(0, 80);
        if (!contentBase64 || contentBase64.length < 16) {
          return res.status(400).json({ error: 'contentBase64 is required' });
        }

        const decoded = decodeKycImage({
          contentBase64,
          contentType: typeof body.contentType === 'string' ? body.contentType : 'image/jpeg',
        });
        const storagePath = `operators/${uid}/vehicles/${vehicleId}/documents/${docKey}/${Date.now()}_${fileName}`;
        const saved = await saveKycImageToStorage({
          storagePath,
          buffer: decoded.buffer,
          contentType: decoded.contentType,
          metadata: {
            operatorId: uid,
            vehicleId,
            documentKey: docKey,
            uploadedBy: uid,
          },
        });

        const uploadedAt = new Date().toISOString();
        const docMeta = {
          status: 'uploaded',
          storagePath: saved.storagePath,
          url: saved.url,
          contentType: decoded.contentType,
          fileName,
          uploadedAt,
        };
        const mergedDocs = mergeKycDocument(
          (vehicleSnap.data()?.documents || {}) as Record<string, unknown>,
          docKey,
          docMeta
        );
        const existingStatus = String(vehicleSnap.data()?.accountStatus || '');
        const preserveModeration = ['approved', 'rejected', 'suspended', 'banned'].includes(
          existingStatus
        );
        await vehicleRef.set(
          {
            accountStatus: preserveModeration
              ? existingStatus
              : hasCompleteKycDocuments(mergedDocs)
                ? 'ready_for_review'
                : 'pending',
            documents: {
              [docKey]: docMeta,
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        res.json({
          status: 'uploaded',
          storagePath: saved.storagePath,
          url: saved.url,
          contentType: decoded.contentType,
          fileName,
          uploadedAt,
        });
      } catch (error: any) {
        console.error('Fleet document upload error:', error);
        res.status(error?.statusCode ?? 500).json({
          error: error?.message || 'Failed to upload fleet document',
        });
      }
    }
  );

  /** Short-lived signed URL for admin to inspect a driver KYC document. */
  app.get(
    '/api/admin/drivers/:uid/documents/:docKey/url',
    ...adminApi,
    async (req: AuthenticatedRequest, res: any) => {
      try {
        const uid = String(req.params.uid || '');
        const docKey = String(req.params.docKey || '');
        const allowed = new Set(['license', 'id', 'registration', 'permit']);
        if (!uid || !allowed.has(docKey)) {
          return res.status(400).json({ error: 'Invalid driver or document key' });
        }

        const driverSnap = await db.collection('drivers').doc(uid).get();
        if (!driverSnap.exists) {
          return res.status(404).json({ error: 'Driver not found' });
        }

        const documents = (driverSnap.data()?.documents || {}) as Record<string, unknown>;
        const raw = documents[docKey];
        const asObj = typeof raw === 'object' && raw ? (raw as Record<string, unknown>) : null;
        const storagePath =
          (asObj?.storagePath != null ? String(asObj.storagePath) : '') ||
          (asObj?.path != null ? String(asObj.path) : '');

        if (!storagePath.startsWith(`drivers/${uid}/documents/${docKey}/`)) {
          return res.status(404).json({
            error: 'Document file not available — driver must re-upload',
            code: 'DOCUMENT_FILE_MISSING',
          });
        }

        const bucket = admin.storage().bucket(kycBucketName());
        const file = bucket.file(storagePath);
        const [exists] = await file.exists();
        if (!exists) {
          return res.status(404).json({
            error: 'Document file missing from storage',
            code: 'DOCUMENT_FILE_MISSING',
          });
        }

        const contentType =
          (asObj?.contentType != null ? String(asObj.contentType) : null) ||
          file.metadata?.contentType ||
          'application/octet-stream';
        const fileName =
          (asObj?.fileName != null ? String(asObj.fileName) : null) || storagePath.split('/').pop() || docKey;

        const [url] = await file.getSignedUrl({
          action: 'read',
          expires: Date.now() + 15 * 60 * 1000,
          version: 'v4',
        });

        res.json({
          url,
          contentType,
          fileName,
          storagePath,
          expiresInSec: 900,
        });
      } catch (error: any) {
        console.error('Admin document signed URL error:', error);
        res.status(error?.statusCode ?? 500).json({
          error: error?.message || 'Failed to create document view URL',
        });
      }
    }
  );

  /** Short-lived signed URL for admin to inspect a fleet vehicle KYC document. */
  app.get(
    '/api/admin/operators/:operatorId/vehicles/:vehicleId/documents/:docKey/url',
    ...adminApi,
    async (req: AuthenticatedRequest, res: any) => {
      try {
        const operatorId = String(req.params.operatorId || '');
        const vehicleId = String(req.params.vehicleId || '');
        const docKey = String(req.params.docKey || '');
        if (!operatorId || !vehicleId || !isKycDocKey(docKey)) {
          return res.status(400).json({ error: 'Invalid fleet document request' });
        }

        const vehicleSnap = await db
          .collection('operators')
          .doc(operatorId)
          .collection('vehicles')
          .doc(vehicleId)
          .get();
        if (!vehicleSnap.exists) {
          return res.status(404).json({ error: 'Vehicle not found' });
        }

        const documents = (vehicleSnap.data()?.documents || {}) as Record<string, unknown>;
        const raw = documents[docKey];
        const asObj = typeof raw === 'object' && raw ? (raw as Record<string, unknown>) : null;
        const storagePath =
          (asObj?.storagePath != null ? String(asObj.storagePath) : '') ||
          (asObj?.path != null ? String(asObj.path) : '');

        if (!storagePath.startsWith(`operators/${operatorId}/vehicles/${vehicleId}/documents/${docKey}/`)) {
          return res.status(404).json({
            error: 'Document file not available — operator must re-upload',
            code: 'DOCUMENT_FILE_MISSING',
          });
        }

        const bucket = admin.storage().bucket(kycBucketName());
        const file = bucket.file(storagePath);
        const [exists] = await file.exists();
        if (!exists) {
          return res.status(404).json({
            error: 'Document file missing from storage',
            code: 'DOCUMENT_FILE_MISSING',
          });
        }

        const contentType =
          (asObj?.contentType != null ? String(asObj.contentType) : null) ||
          file.metadata?.contentType ||
          'image/jpeg';
        const fileName =
          (asObj?.fileName != null ? String(asObj.fileName) : null) ||
          storagePath.split('/').pop() ||
          docKey;

        const [url] = await file.getSignedUrl({
          action: 'read',
          expires: Date.now() + 15 * 60 * 1000,
          version: 'v4',
        });

        res.json({
          url,
          contentType,
          fileName,
          storagePath,
          expiresInSec: 900,
        });
      } catch (error: any) {
        console.error('Admin fleet document signed URL error:', error);
        res.status(error?.statusCode ?? 500).json({
          error: error?.message || 'Failed to create fleet document view URL',
        });
      }
    }
  );

  app.patch(
    '/api/admin/operators/:operatorId/vehicles/:vehicleId/status',
    ...adminApi,
    async (req: AuthenticatedRequest, res: any) => {
      try {
        const operatorId = String(req.params.operatorId || '');
        const vehicleId = String(req.params.vehicleId || '');
        const { status, reason } = req.body || {};
        if (!operatorId || !vehicleId || !status) {
          return res.status(400).json({ error: 'operator, vehicle, and status are required' });
        }
        await updateAdminFleetVehicleStatus(
          db,
          operatorId,
          vehicleId,
          status,
          req.firebaseUid!,
          { reason: typeof reason === 'string' ? reason : undefined }
        );
        res.json({ success: true, operatorId, vehicleId, status });
      } catch (error: any) {
        console.error('Admin fleet status update error:', error);
        res.status(error?.statusCode ?? 500).json({
          error: error?.message || 'Failed to update fleet driver status',
        });
      }
    }
  );

  app.patch('/api/admin/drivers/:uid/status', ...adminApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      const { uid } = req.params;
      const { status, reason } = req.body;

      if (!status) {
        return res.status(400).json({ error: 'status is required' });
      }

      await updateAdminDriverStatus(db, uid, status, req.firebaseUid!, {
        reason: typeof reason === 'string' ? reason : undefined,
      });
      res.json({ success: true, uid, status });
    } catch (error: any) {
      console.error('Admin driver status update error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to update driver status',
      });
    }
  });

  app.patch('/api/admin/drivers/:uid/document-expiries', ...adminApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      const { uid } = req.params;
      const documentExpiries = req.body?.documentExpiries || req.body || {};
      await updateAdminDriverDocumentExpiries(db, uid, documentExpiries, req.firebaseUid!);
      res.json({ success: true, uid, documentExpiries });
    } catch (error: any) {
      console.error('Admin driver document expiries error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to update document expiries',
      });
    }
  });

  app.get('/api/admin/customers', ...adminApi, async (_req: AuthenticatedRequest, res: any) => {
    try {
      const customers = await listAdminCustomers(db);
      res.json({ customers });
    } catch (error: any) {
      console.error('Admin customers list error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to load customers',
      });
    }
  });

  app.patch('/api/admin/customers/:uid/status', ...adminApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      const { uid } = req.params;
      const { status } = req.body;
      if (!status) {
        return res.status(400).json({ error: 'status is required' });
      }
      await updateAdminCustomerStatus(db, uid, status, req.firebaseUid!);
      res.json({ success: true, uid, status });
    } catch (error: any) {
      console.error('Admin customer status update error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to update customer status',
      });
    }
  });

  app.get('/api/admin/financials', ...adminApi, async (_req: AuthenticatedRequest, res: any) => {
    try {
      const ledger = await getAdminFinancialLedger(db);
      res.json(ledger);
    } catch (error: any) {
      console.error('Admin financials error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to load financial ledger',
      });
    }
  });

  const clientWriteRequired = (action: string) => ({
    error: `${action} requires Admin Firestore (no service account on this machine)`,
    code: 'CLIENT_WRITE_REQUIRED',
    clientWriteRequired: true,
  });

  // ---- Driver payout / withdrawal requests ----
  app.get('/api/admin/withdrawals', ...adminApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      if (!canUseAdminFirestore()) {
        return res.status(503).json(clientWriteRequired('Withdrawals'));
      }
      const status = (req.query.status as string) || 'all';
      const allowed = new Set(['all', 'pending', 'paid', 'rejected']);
      if (!allowed.has(status)) {
        return res.status(400).json({ error: 'Invalid status filter' });
      }
      const withdrawals = await listWithdrawalsForAdmin(
        db,
        status as 'all' | 'pending' | 'paid' | 'rejected'
      );
      res.json({ withdrawals });
    } catch (error: any) {
      if (isFirebaseAdminCredentialError(error)) {
        return res.status(503).json(clientWriteRequired('Withdrawals'));
      }
      console.error('Admin withdrawals list error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to load withdrawals',
      });
    }
  });

  app.post(
    '/api/admin/withdrawals/:id/approve',
    ...adminApi,
    async (req: AuthenticatedRequest, res: any) => {
      try {
        if (!canUseAdminFirestore()) {
          return res.status(503).json(clientWriteRequired('Withdrawals'));
        }
        const result = await approveWithdrawal(db, req.params.id, req.firebaseUid!);
        res.json({ success: true, withdrawal: result });
      } catch (error: any) {
        if (isFirebaseAdminCredentialError(error)) {
          return res.status(503).json(clientWriteRequired('Withdrawals'));
        }
        console.error('Approve withdrawal error:', error);
        res.status(error?.statusCode ?? 500).json({
          error: error?.message || 'Failed to approve withdrawal',
        });
      }
    }
  );

  app.post(
    '/api/admin/withdrawals/:id/reject',
    ...adminApi,
    async (req: AuthenticatedRequest, res: any) => {
      try {
        if (!canUseAdminFirestore()) {
          return res.status(503).json(clientWriteRequired('Withdrawals'));
        }
        const reason =
          typeof req.body?.reason === 'string' ? req.body.reason : undefined;
        const result = await rejectWithdrawal(
          db,
          req.params.id,
          req.firebaseUid!,
          reason
        );
        res.json({ success: true, withdrawal: result });
      } catch (error: any) {
        if (isFirebaseAdminCredentialError(error)) {
          return res.status(503).json(clientWriteRequired('Withdrawals'));
        }
        console.error('Reject withdrawal error:', error);
        res.status(error?.statusCode ?? 500).json({
          error: error?.message || 'Failed to reject withdrawal',
        });
      }
    }
  );

  app.get('/api/driver/bank-details', ...secureApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      if (!canUseAdminFirestore()) {
        return res.status(503).json(clientWriteRequired('Bank details'));
      }
      const details = await getDriverBankDetails(db, req.firebaseUid!);
      res.json({ bankDetails: details });
    } catch (error: any) {
      if (isFirebaseAdminCredentialError(error)) {
        return res.status(503).json(clientWriteRequired('Bank details'));
      }
      console.error('Get bank details error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to load bank details',
      });
    }
  });

  app.put('/api/driver/bank-details', ...secureApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      if (!canUseAdminFirestore()) {
        return res.status(503).json(clientWriteRequired('Bank details'));
      }
      const saved = await saveDriverBankDetails(db, req.firebaseUid!, {
        bankName: req.body?.bankName,
        iban: req.body?.iban,
        accountHolderName: req.body?.accountHolderName,
      });
      res.json({ success: true, bankDetails: saved });
    } catch (error: any) {
      if (isFirebaseAdminCredentialError(error)) {
        return res.status(503).json(clientWriteRequired('Bank details'));
      }
      console.error('Save bank details error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to save bank details',
      });
    }
  });

  app.get('/api/driver/withdrawals', ...secureApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      if (!canUseAdminFirestore()) {
        return res.status(503).json(clientWriteRequired('Withdrawals'));
      }
      const withdrawals = await listWithdrawalsForDriver(db, req.firebaseUid!);
      res.json({ withdrawals });
    } catch (error: any) {
      if (isFirebaseAdminCredentialError(error)) {
        return res.status(503).json(clientWriteRequired('Withdrawals'));
      }
      console.error('Driver withdrawals list error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to load withdrawals',
      });
    }
  });

  app.post('/api/driver/withdrawals', ...secureApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      if (!canUseAdminFirestore()) {
        return res.status(503).json(clientWriteRequired('Withdrawals'));
      }
      const amount = Number(req.body?.amount);
      const withdrawal = await createWithdrawalRequest(db, req.firebaseUid!, amount, {
        bankName: req.body?.bankName,
        iban: req.body?.iban,
        accountHolderName: req.body?.accountHolderName,
      });
      res.status(201).json({ success: true, withdrawal });
    } catch (error: any) {
      if (isFirebaseAdminCredentialError(error)) {
        return res.status(503).json(clientWriteRequired('Withdrawals'));
      }
      console.error('Create withdrawal error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to create withdrawal request',
      });
    }
  });

  // Helper: Moyasar API Client
  const moyasar = axios.create({
    baseURL: MOYASAR_API_URL,
    auth: {
      username: config.moyasarSecretKey,
      password: '',
    },
  });

  // API Route: Calculate Price (authenticated quote preview — same engine as order create)
  app.post('/api/calculate-price', ...secureApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      const result = await pricingService.calculatePrice(req.body);
      res.json(result);
    } catch (error) {
      console.error('Calculation error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Calculation failed' });
    }
  });

  // API Route: Create Order (P0-8 — server-only, Admin SDK)
  app.post('/api/orders', ...secureApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      // Orders are created only after payment. This endpoint now prepares a checkout draft.
      const userId = req.firebaseUid!;
      const result = await createCheckoutDraft(db, pricingService, userId, req.body);
      res.status(201).json(result);
    } catch (error: any) {
      console.error('Create order (draft) error:', error);
      const statusCode = error?.statusCode ?? 500;
      res.status(statusCode).json({
        error: error?.message || 'Failed to prepare checkout draft',
      });
    }
  });

  // API Route: Create Moyasar Payment Intent from checkout draft (no orders write).
  app.post('/api/create-payment-intent', ...secureApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      assertMoyasarConfigured(config);
      const { draftId, orderId, callbackUrl, paymentMethod: rawMethod } = req.body;
      const userId = req.firebaseUid!;

      const allowedMethods = new Set(['mada', 'creditcard', 'applepay']);
      const paymentMethod = allowedMethods.has(rawMethod) ? rawMethod : 'mada';

      let chargeDraftId = draftId ? String(draftId) : '';
      let financials: Record<string, any> | null = null;
      let serviceType = 'transport';
      let customerTotal = 0;
      let serviceDetails: Record<string, unknown> = {};

      if (chargeDraftId) {
        const draftSnap = await db.collection('checkout_drafts').doc(chargeDraftId).get();
        if (!draftSnap.exists) {
          return res.status(404).json({ error: 'Checkout draft not found' });
        }
        const draft = draftSnap.data() as Record<string, any>;
        if (draft.userId !== userId) {
          return res.status(403).json({ error: 'Draft does not belong to authenticated user' });
        }
        financials = draft.financials || null;
        serviceType = draft.payload?.serviceType || serviceType;
        serviceDetails =
          (draft.payload?.serviceDetails as Record<string, unknown> | undefined) || {};
        customerTotal = Number(financials?.customerTotal || 0);
      } else if (orderId) {
        // Legacy path — prefer draftId; order must already exist (should be rare).
        const orderSnap = await db.collection('orders').doc(orderId).get();
        if (!orderSnap.exists) {
          return res.status(404).json({ error: 'Order not found — prepare a checkout draft first' });
        }
        const order = orderSnap.data() as Record<string, any>;
        if (order.userId !== userId) {
          return res.status(403).json({ error: 'Order does not belong to authenticated user' });
        }
        financials = order.financials || null;
        serviceType = order.serviceType || serviceType;
        serviceDetails = (order.serviceDetails as Record<string, unknown> | undefined) || {};
        customerTotal = Number(financials?.customerTotal ?? order.totalPrice ?? order.price ?? 0);
        chargeDraftId = String(order.checkoutDraftId || '');
      } else {
        return res.status(400).json({ error: 'draftId is required' });
      }

      if (!customerTotal || customerTotal <= 0) {
        return res.status(400).json({ error: 'No valid charge amount on checkout draft' });
      }

      const amountInHalalas = Math.round(customerTotal * 100);

      const moyasarCallbackUrl = resolveMoyasarCallbackUrl(
        callbackUrl,
        config.appUrl,
        { lockToAppUrl: config.deployEnv !== 'development' }
      );

      const waterBits = [
        serviceDetails.waterType != null ? String(serviceDetails.waterType) : '',
        serviceDetails.capacity != null ? String(serviceDetails.capacity) : '',
      ].filter(Boolean);
      const moyasarDescription =
        waterBits.length > 0
          ? `Miras Order - ${serviceType} (${waterBits.join('/')})`
          : `Miras Order - ${serviceType}`;

      const moyasarResponse = await moyasar.post('/payments', {
        amount: amountInHalalas,
        currency: 'SAR',
        description: moyasarDescription,
        callback_url: moyasarCallbackUrl,
        metadata: {
          userId,
          draftId: chargeDraftId || null,
          orderId: orderId || null,
          serviceType,
          paymentMethod,
          platformFee:
            (financials?.platformFee ?? 0) + (financials?.serviceFee ?? 0),
          driverAmount: financials?.driverNet ?? 0,
        },
        source: {
          type: 'creditcard',
        },
      });

      const payment = moyasarResponse.data;

      const paymentRef = await db.collection('payments').add({
        userId,
        draftId: chargeDraftId || null,
        orderId: null,
        amount: customerTotal,
        tripFare: financials?.tripFare,
        serviceFee: financials?.serviceFee,
        platformFee: financials?.platformFee,
        driverAmount: financials?.driverNet,
        financials: financials ?? null,
        status: 'pending',
        paymentMethod,
        transactionId: payment.id,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      res.json({
        paymentId: paymentRef.id,
        moyasarId: payment.id,
        paymentUrl:
          payment.source.transaction_url ||
          `${MOYASAR_API_URL}/payments/${payment.id}/form`,
        draftId: chargeDraftId || null,
        orderId: null,
        amount: customerTotal,
        paymentMethod,
      });
    } catch (error) {
      console.error('Moyasar Init Error:', error);
      res.status(500).json({ error: 'Failed to initialize real payment with Moyasar' });
    }
  });

  // P0-12: Atomic driver accept (first driver wins)
  app.post('/api/orders/:orderId/accept', ...secureApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      if (!canUseAdminFirestore()) {
        return res.status(503).json(clientWriteRequired('Order accept'));
      }

      const { orderId } = req.params;
      const driverId = req.firebaseUid!;
      const { driverName, driverPhone, truckDetails } = req.body;

      const driverProfile = await verifyApprovedDriverAccess(db, driverId);

      if (!driverProfile.vehicleType) {
        return res.status(403).json({
          error: 'Driver vehicle type is not registered — cannot accept orders',
          code: 'VEHICLE_TYPE_REQUIRED',
        });
      }

      const result = await executeAcceptOrder(db, {
        orderId,
        driverId,
        driverName: driverName || driverProfile.name || 'Driver',
        driverPhone: driverPhone || driverProfile.phone || '',
        truckDetails: truckDetails || '',
        vehicleType: driverProfile.vehicleType,
      });

      res.json(result);
    } catch (error: any) {
      if (isFirebaseAdminCredentialError(error)) {
        return res.status(503).json(clientWriteRequired('Order accept'));
      }
      console.error('Accept order error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to accept order',
      });
    }
  });

  // Driver completes a trip — server credits wallets/{driverId} from order.financials.
  app.post('/api/orders/:orderId/complete', ...secureApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      if (!canUseAdminFirestore()) {
        return res.status(503).json({
          error: 'Wallet credit requires Admin Firestore',
          code: 'CLIENT_WRITE_REQUIRED',
          clientWriteRequired: true,
        });
      }

      const { orderId } = req.params;
      const result = await executeCompleteOrder(db, {
        orderId,
        driverId: req.firebaseUid!,
      });
      res.json(result);
    } catch (error: any) {
      if (isFirebaseAdminCredentialError(error)) {
        return res.status(503).json({
          error: 'Wallet credit requires Admin Firestore',
          code: 'CLIENT_WRITE_REQUIRED',
          clientWriteRequired: true,
        });
      }
      console.error('Complete order error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to complete order',
      });
    }
  });

  // P0-12: Driver status progression (driver_arrived, in_transit)
  app.post('/api/orders/:orderId/status', ...secureApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      if (!canUseAdminFirestore()) {
        return res.status(503).json(clientWriteRequired('Order status update'));
      }

      const { orderId } = req.params;
      const { status } = req.body;
      const driverId = req.firebaseUid!;

      if (!status) {
        return res.status(400).json({ error: 'status is required' });
      }

      const result = await executeTransitionOrder(db, {
        orderId,
        driverId,
        toStatus: status,
      });

      res.json(result);
    } catch (error: any) {
      if (isFirebaseAdminCredentialError(error)) {
        return res.status(503).json(clientWriteRequired('Order status update'));
      }
      console.error('Transition order error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to update order status',
      });
    }
  });

  // P0-10: Secure account deletion (customer + driver only)
  app.post('/api/account/delete', ...secureApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      if (req.body?.confirm !== true) {
        return res.status(400).json({ error: 'confirm: true is required for account deletion' });
      }

      const uid = req.firebaseUid!;
      const result = await executeDeleteAccount(db, admin.auth(), { uid });
      res.json(result);
    } catch (error: any) {
      console.error('Account deletion error:', error);
      res.status(error?.statusCode ?? 500).json({
        error: error?.message || 'Failed to delete account',
      });
    }
  });

  // API Route: Capture Payment (authenticated assigned driver only)
  app.post('/api/capture-payment', ...secureApi, async (req: AuthenticatedRequest, res: any) => {
    try {
      const { paymentId, orderId, driverId } = req.body;
      if (!paymentId || !orderId) {
        return res.status(400).json({ error: 'paymentId and orderId required' });
      }

      const authenticatedDriverId = req.firebaseUid!;
      if (driverId && driverId !== authenticatedDriverId) {
        return res.status(403).json({ error: 'driverId must match authenticated user' });
      }

      const result = await executeCapturePayment(db, {
        paymentId,
        orderId,
        driverId: authenticatedDriverId,
      });

      res.json({
        success: true,
        capturedAmount: result.capturedAmount,
        alreadyCaptured: result.alreadyCaptured ?? false,
      });
    } catch (error: any) {
      console.error('Capture error:', error);
      const statusCode = error?.statusCode ?? 500;
      res.status(statusCode).json({
        error: error?.message || 'Failed to capture payment',
      });
    }
  });

  // Unknown /api routes — JSON 404 (never SPA HTML), both local and Cloud Run.
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: 'API endpoint not found',
      path: req.originalUrl,
      service: 'miras-api',
    });
  });

  // Vite middleware for development
  if (!config.isProduction) {
    const viteMode = 'development';
    const vite = await createViteServer({
      root: process.cwd(),
      mode: viteMode,
      configFile: path.join(process.cwd(), 'vite.config.ts'),
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    const indexPath = path.join(distPath, 'index.html');
    const hasSpaBundle = fs.existsSync(indexPath);

    if (hasSpaBundle) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        if (req.path.startsWith('/api') || req.path === '/health') {
          return res.status(404).json({
            error: 'Not found',
            path: req.originalUrl,
            service: 'miras-api',
          });
        }
        res.sendFile(indexPath);
      });
    } else {
      console.info('[server] API-only mode — no dist/index.html; serving /api/* and /health only');
      app.use((req, res) => {
        res.status(404).json({
          error: 'Not found',
          path: req.originalUrl,
          service: 'miras-api',
          hint: 'This Cloud Run service is API-only. SPA is served by Firebase Hosting.',
        });
      });
    }
  }

  // Last-resort JSON errors for /api (avoids Express default HTML error pages).
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[server] unhandled error:', err);
    if (res.headersSent) return;
    if (req.path.startsWith('/api') || req.path === '/health') {
      res.status(err?.statusCode || err?.status || 500).json({
        error: err?.message || 'Internal server error',
        service: 'miras-api',
      });
      return;
    }
    res.status(err?.statusCode || err?.status || 500).json({
      error: err?.message || 'Internal server error',
    });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on 0.0.0.0:${PORT}`);
    if (!config.isProduction) {
      console.log(
        `[Phone Auth] Use http://127.0.0.1:${PORT} — Firebase blocks Phone Auth on hostname "localhost".`
      );
    }
    // Cloud Run API image is request-scaled (CPU sleeps) and does not ship agent source.
    // Run IMAP/HITL as the dedicated hamula-agents worker instead.
    if (
      process.env.MIRAS_AGENTS_ENABLED === 'true' &&
      process.env.MIRAS_PROCESS_ROLE !== 'api'
    ) {
      void import('./src/agents/whatsapp.js')
        .then((mod) => mod.startAgentRuntime())
        .catch((error) => {
          console.error('[agents] failed to start supervisor:', error?.message || error);
        });
    }
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
