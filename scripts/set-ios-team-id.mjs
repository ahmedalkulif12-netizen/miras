/**
 * Apply the 10-character Apple Developer Team ID across AASA, Xcode, and export options.
 * Usage: node scripts/set-ios-team-id.mjs ABCD123456
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  assertAppleTeamId,
  projectRootFrom,
  writeAppleAppSiteAssociationFiles,
  writeExportOptionsTeam,
  writeTeamXcconfig,
} from './appleTeamId.mjs';

const root = projectRootFrom(import.meta.url);
const teamId = assertAppleTeamId(String(process.argv[2] || process.env.VITE_IOS_TEAM_ID || '').trim().toUpperCase());

writeAppleAppSiteAssociationFiles(teamId, root);
writeTeamXcconfig(teamId, root);
writeExportOptionsTeam(teamId, root);

const appfile = path.join(root, 'fastlane', 'Appfile');
if (fs.existsSync(appfile)) {
  let body = fs.readFileSync(appfile, 'utf8');
  body = body.replace(/team_id\(["'][^"']*["']\)/, `team_id("${teamId}")`);
  fs.writeFileSync(appfile, body);
}

const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  let env = fs.readFileSync(envPath, 'utf8');
  if (/^VITE_IOS_TEAM_ID=/m.test(env)) {
    env = env.replace(/^VITE_IOS_TEAM_ID=.*$/m, `VITE_IOS_TEAM_ID=${teamId}`);
  } else {
    env += `\nVITE_IOS_TEAM_ID=${teamId}\n`;
  }
  fs.writeFileSync(envPath, env);
}

console.log(`Apple Team ID ${teamId} written to AASA, ios/Config/Team.xcconfig, ExportOptions.plist, and .env`);
