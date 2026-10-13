"""SAIP software-deposit brief for JZ Logistics version 1.0.3.

Describes the implemented system: a React / TypeScript web application
inside Capacitor shells, with a Node.js API, Firebase, and Moyasar.
"""

from __future__ import annotations

import os
from xml.sax.saxutils import escape

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    ListFlowable,
    ListItem,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

INK = colors.HexColor("#111111")
MUTED = colors.HexColor("#3F3F3F")
GOLD = colors.HexColor("#FFCC00")
PANEL = colors.HexColor("#F6F6F4")
LINE = colors.HexColor("#E4E4E0")
CODE_BG = colors.HexColor("#F3F1EA")


def rtl(text: str) -> str:
    return get_display(arabic_reshaper.reshape(text))


def desktop_dir() -> str:
    try:
        import ctypes

        buffer = ctypes.create_unicode_buffer(32767)
        if ctypes.windll.shell32.SHGetFolderPathW(None, 0x0010, None, 0, buffer) == 0 and buffer.value:
            return buffer.value
    except Exception:
        pass
    return os.path.join(os.path.expanduser("~"), "Desktop")


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont("Tahoma", r"C:\Windows\Fonts\tahoma.ttf"))
    pdfmetrics.registerFont(TTFont("Tahoma-Bold", r"C:\Windows\Fonts\tahomabd.ttf"))
    pdfmetrics.registerFont(TTFont("Consolas", r"C:\Windows\Fonts\consola.ttf"))
    pdfmetrics.registerFontFamily("Tahoma", normal="Tahoma", bold="Tahoma-Bold")


def styles() -> dict[str, ParagraphStyle]:
    return {
        "kicker": ParagraphStyle(
            "Kicker",
            fontName="Tahoma-Bold",
            fontSize=8,
            leading=11,
            textColor=colors.HexColor("#6A5600"),
            tracking=0.6,
            spaceAfter=4,
        ),
        "title": ParagraphStyle(
            "Title",
            fontName="Tahoma-Bold",
            fontSize=20,
            leading=26,
            textColor=INK,
            spaceAfter=4,
        ),
        "subtitle": ParagraphStyle(
            "Subtitle",
            fontName="Tahoma",
            fontSize=11,
            leading=15,
            textColor=MUTED,
            spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "H2",
            fontName="Tahoma-Bold",
            fontSize=13,
            leading=17,
            textColor=INK,
            spaceBefore=12,
            spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "Body",
            fontName="Tahoma",
            fontSize=9.5,
            leading=14,
            textColor=MUTED,
            alignment=TA_JUSTIFY,
            spaceAfter=7,
        ),
        "cell": ParagraphStyle(
            "Cell",
            fontName="Tahoma",
            fontSize=8.5,
            leading=12,
            textColor=INK,
        ),
        "head": ParagraphStyle(
            "Head",
            fontName="Tahoma-Bold",
            fontSize=8.5,
            leading=12,
            textColor=colors.white,
        ),
        "cell_label": ParagraphStyle(
            "CellLabel",
            fontName="Tahoma-Bold",
            fontSize=8.5,
            leading=12,
            textColor=INK,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            fontName="Tahoma",
            fontSize=9.5,
            leading=13,
            textColor=MUTED,
        ),
        "code": ParagraphStyle(
            "Code",
            fontName="Consolas",
            fontSize=8,
            leading=11,
            textColor=INK,
        ),
        "notice": ParagraphStyle(
            "Notice",
            fontName="Tahoma",
            fontSize=9,
            leading=13,
            textColor=INK,
            alignment=TA_LEFT,
        ),
    }


def P(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(text, style)


def bullets(items: list[str], style: ParagraphStyle) -> ListFlowable:
    return ListFlowable(
        [ListItem(Paragraph(item, style), leftIndent=8) for item in items],
        bulletType="bullet",
        start="•",
        leftIndent=14,
        bulletFontName="Tahoma",
        bulletFontSize=8,
        bulletColor=INK,
        spaceBefore=1,
        spaceAfter=6,
    )


def identity_table(s: dict[str, ParagraphStyle]) -> Table:
    rows = [
        ["Field", "Record"],
        ["Application name", "JZ Logistics (Jazeed Logistics)"],
        ["Arabic name", rtl("جيزيد للخدمات اللوجستية")],
        ["Deposit category", "Software and computer-application deposit"],
        ["Arabic category", rtl("برمجيات وتطبيقات الحاسب الآلي")],
        ["Display version", "1.0.3"],
        ["Android application id", "com.miras.app  (versionCode 4)"],
        ["iOS bundle identifier", "com.ahmed.miras"],
        ["Client", "React 19, TypeScript, Vite"],
        ["Mobile shells", "Capacitor WebView for Android and iOS"],
        ["Application server", "Node.js HTTP API"],
        ["Data and sign-in", "Firebase Authentication and Cloud Firestore"],
        ["Payments", "Moyasar hosted checkout"],
        ["Maps", "Google Maps"],
    ]
    data = []
    for i, (label, value) in enumerate(rows):
        if i == 0:
            data.append([P(escape(label), s["head"]), P(escape(value), s["head"])])
        else:
            data.append([P(escape(label), s["cell_label"]), P(escape(value), s["cell"])])
    table = Table(data, colWidths=[52 * mm, 118 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), INK),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("BACKGROUND", (0, 1), (0, -1), PANEL),
                ("FONTNAME", (0, 0), (-1, 0), "Tahoma-Bold"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("GRID", (0, 0), (-1, -1), 0.3, LINE),
                ("LINEBELOW", (0, 0), (-1, 0), 2, GOLD),
            ]
        )
    )
    return table


def draw_page(canvas, doc) -> None:
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(INK)
    canvas.rect(0, height - 16 * mm, width, 16 * mm, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.rect(0, height - 17.4 * mm, width, 1.4 * mm, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont("Tahoma", 8)
    canvas.drawString(16 * mm, height - 10 * mm, "JZ Logistics")
    canvas.drawRightString(width - 16 * mm, height - 10 * mm, "SAIP software deposit")
    canvas.setFillColor(GOLD)
    canvas.rect(0, 0, width, 2.2 * mm, fill=1, stroke=0)
    canvas.setFillColor(MUTED)
    canvas.setFont("Tahoma", 8)
    canvas.drawString(16 * mm, 8 * mm, "Version 1.0.3  ·  Software and technical documentation")
    canvas.drawRightString(width - 16 * mm, 8 * mm, f"Page {doc.page}")
    canvas.restoreState()


def build() -> str:
    register_fonts()
    s = styles()
    out = os.path.join(desktop_dir(), "JZ_Logistics_Software_Documentation.pdf")
    doc = SimpleDocTemplate(
        out,
        pagesize=A4,
        rightMargin=16 * mm,
        leftMargin=16 * mm,
        topMargin=24 * mm,
        bottomMargin=16 * mm,
        title="JZ Logistics - Software & Technical Documentation",
        author="JZ Logistics",
        subject="Software deposit for the Saudi Authority for Intellectual Property",
    )

    tree = """src/
  main.tsx                         application entry
  App.tsx                          routes and role shells
  pages/
    LoginPage.tsx                  phone verification
    CustomerDashboard.tsx          booking, payment, live tracking
    DriverDashboard.tsx            offers, accept, trip progress
    ProfilePage.tsx                account and service rating
    SupportPage.tsx                help, email, and phone support
  domain/
    dispatchMatching.ts            pickup-based driver search
    order-status.ts                order lifecycle
    serviceCategories.ts           six shipment categories
    financials.ts                  trip money fields
    pricing-engine.ts              distance and price
  lib/
    phoneAuth.ts                   one-time phone sign-in
    liveTracking.ts                driver GPS stream
    paymentService.ts              hosted payment start
    orderService.ts                order reads and writes
    tripDistance.ts                road distance and arrival estimate
  components/
    BookingLocationMap.tsx         pickup and drop-off pins
    LiveTrackingMap.tsx            customer tracking map
server.ts                          authenticated HTTP API
android/                           Capacitor Android shell
ios/                               Capacitor iOS shell"""

    story: list = [
        P("SOFTWARE DEPOSIT FILE", s["kicker"]),
        P("JZ Logistics — Software &amp; Technical Documentation", s["title"]),
        P(
            "Prepared for the Saudi Authority for Intellectual Property "
            "(SAIP). This file describes version 1.0.3 of the JZ Logistics "
            "application as implemented in its source tree.",
            s["subtitle"],
        ),
        HRFlowable(width="100%", thickness=2, color=GOLD, spaceAfter=10),
        P("1. Application identity", s["h2"]),
        P(
            "JZ Logistics, also referred to as Jazeed Logistics "
            f"({rtl('جيزيد للخدمات اللوجستية')}), is deposited as a software "
            "and computer-application work "
            f"({rtl('برمجيات وتطبيقات الحاسب الآلي')}). "
            "The store display name is JZ Logistics. The Android package "
            "name and the iOS bundle identifier below are the registered "
            "application identities used by the stores and by Firebase. "
            "They are part of this work and are not a separate product.",
            s["body"],
        ),
        identity_table(s),
        Spacer(1, 8),
        P("2. What the software does", s["h2"]),
        P(
            "JZ Logistics is a smart logistics and shipment-management "
            "platform for GCC countries. Version 1.0.3 runs the customer "
            "booking, driver dispatch, live tracking, and payment flows, "
            "with the operating release focused on shipments in Saudi Arabia. "
            "A customer chooses a service, sets the pickup and the drop-off, "
            "receives a distance and a price, pays, and then follows the "
            "assigned driver. A driver sees nearby offers and moves the trip "
            "from acceptance through arrival, transit, and completion.",
            s["body"],
        ),
        P("The six shipment categories in this version are:", s["body"]),
        bullets(
            [
                "Furniture moving",
                "Flatbed transport",
                "Refrigerated transport",
                "Heavy equipment",
                "Goods transport",
                "Water tankers, which are booked from the drop-off only",
            ],
            s["bullet"],
        ),
        P("3. Technical architecture", s["h2"]),
        P(
            "The product is one web application shared by the browser and by "
            "the mobile stores. It is not a Flutter or React Native project. "
            "Android and iOS are Capacitor shells that load the same "
            "TypeScript interface.",
            s["body"],
        ),
        bullets(
            [
                "<b>Mobile and web frontend.</b> React 19 and TypeScript, built with Vite. Capacitor packages that build as an Android application (com.miras.app) and an iOS application (com.ahmed.miras).",
                "<b>Backend services.</b> A Node.js HTTP API (server.ts) checks the signed-in user before order, payment, profile, and admin actions. The public website is served as a static application, and the API runs as a separate service.",
                "<b>Real-time tracking.</b> After a driver accepts, the driver device publishes GPS. The customer map reads that position and shows an arrival estimate for the current stage of the trip.",
                "<b>Payment gateway.</b> The client asks the API to start a Moyasar hosted invoice and then opens that payment page. Card details are collected by the gateway, not by a secret key inside the application interface.",
                "<b>Sign-in and data.</b> Customers and drivers sign in with a mobile number and a one-time code through Firebase Authentication. Orders, offers, and live positions are stored in Cloud Firestore under security rules that limit what each role may write.",
            ],
            s["bullet"],
        ),
        P("4. Key modules", s["h2"]),
        P("<b>Authentication.</b> Phone verification is the only customer and driver sign-in. The login screen does not offer email-and-password or a social-network account. Session checks on the API reject unsigned requests to protected routes.", s["body"]),
        P("<b>Order management.</b> A booking is two steps for transport: the pickup location, then the drop-off. The application then shows the route, the distance, and the price. After payment, the order is offered to drivers. Status moves through assigned, arrived, in transit, and completed. Water-tanker orders use the drop-off as the working location.", s["body"]),
        P("<b>Dispatch.</b> Drivers are matched to the pickup pin, not to the customer’s phone position and not to the drop-off, except for water tankers, which match the drop-off. The search starts near that pin and expands in stages (8 km, then 20 km, then 30 km), and it does not offer the trip to a driver in a different city beyond the expanded limit.", s["body"]),
        P("<b>Real-time location.</b> Live tracking stays off while the order is still searching for a driver. It starts when the trip is assigned. The map follows the driver toward the pickup, then from the pickup toward the drop-off. The arrival line is calculated from the latest GPS fix.", s["body"]),
        P("<b>Alerts in this version.</b> The signed-in user sees order status, the live trip, and in-app trip messages. Version 1.0.3 does not ship a separate Firebase Cloud Messaging or Apple push-notification module. Support contact in the product is email and a direct phone call.", s["body"]),
    ]

    code = Preformatted(tree, s["code"])
    code_table = Table([[code]], colWidths=[170 * mm])
    code_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
                ("BOX", (0, 0), (-1, -1), 0.4, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("LINEBEFORE", (0, 0), (0, 0), 3, GOLD),
            ]
        )
    )
    story.append(
        KeepTogether(
            [
                P("5. Source layout", s["h2"]),
                P(
                    "The tree below is the layout of the work being deposited. It names "
                    "the modules that implement the behaviour above. Secrets, keystores, "
                    "and environment files are not part of this narrative.",
                    s["body"],
                ),
                code_table,
            ]
        )
    )

    story.extend(
        [
            P("6. Principal workflows", s["h2"]),
            bullets(
                [
                    "<b>Book.</b> Choose a service, confirm the pickup, confirm the drop-off, then review distance and price.",
                    "<b>Pay and offer.</b> Payment is completed on the hosted gateway. The paid order is then offered to eligible drivers.",
                    "<b>Accept.</b> The first eligible driver to accept is assigned. The claim writes only the assignment fields allowed for that action.",
                    "<b>Track.</b> The customer follows the driver to the pickup and then to the drop-off, with an on-screen arrival estimate.",
                    "<b>Close.</b> The trip is completed, and the customer can leave a star rating and a comment.",
                ],
                s["bullet"],
            ),
            P("7. Intellectual property statement", s["h2"]),
            P(
                "The owner of JZ Logistics (Jazeed Logistics) declares original "
                "ownership of this application. That ownership covers the "
                "application source code, the user-interface and user-experience "
                "designs, the brand presentation of JZ Logistics, and the system "
                "workflows described in this document, including booking, "
                "dispatch, live tracking, payment handoff, and driver assignment.",
                s["body"],
            ),
            P(
                "This deposit is made so the work can be recorded with the "
                "Saudi Authority for Intellectual Property as a software and "
                "computer-application work. Copying, reproduction, modification, "
                "or redistribution of the source code, screens, or workflows "
                "without the owner’s permission is not allowed.",
                s["body"],
            ),
            P(
                rtl(
                    "يقر مالك تطبيق جيزيد للخدمات اللوجستية بملكيته الأصلية لشفرة المصدر، وتصميمات الواجهة وتجربة الاستخدام، ومسارات عمل النظام، ويطلب إيداع هذا العمل لدى الهيئة السعودية للملكية الفكرية ضمن برمجيات وتطبيقات الحاسب الآلي."
                ),
                s["body"],
            ),
        ]
    )

    notice = Table(
        [[
            P(
                "<b>Deposit notice.</b> This document is a technical description of JZ Logistics version 1.0.3 for an SAIP software deposit. It does not disclose passwords, API secrets, or payment credentials. The facts above match the implemented source code, including the React and Capacitor architecture.",
                s["notice"],
            )
        ]],
        colWidths=[170 * mm],
    )
    notice.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PANEL),
                ("BOX", (0, 0), (-1, -1), 0.6, INK),
                ("LINEBEFORE", (0, 0), (0, 0), 4, GOLD),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.extend([Spacer(1, 6), notice])

    doc.build(story, onFirstPage=draw_page, onLaterPages=draw_page)
    return out


if __name__ == "__main__":
    path = build()
    print(f"Documentation PDF generated successfully at: {path}")
