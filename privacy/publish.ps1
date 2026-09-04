# Publishes privacy/ as a public GitHub Pages site.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File privacy\publish.ps1

$ErrorActionPreference = "Stop"
$RepoName = "miras-privacy"
$SiteDir = $PSScriptRoot

function Find-Tool([string]$name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $guesses = @(
    "$env:ProgramFiles\Git\cmd\git.exe",
    "$env:ProgramFiles\GitHub CLI\gh.exe",
    "${env:ProgramFiles(x86)}\Git\cmd\git.exe"
  )
  foreach ($g in $guesses) {
    if (($g -like "*$name.exe") -and (Test-Path $g)) { return $g }
  }
  return $null
}

Set-Location $SiteDir

$git = Find-Tool "git"
$gh = Find-Tool "gh"

if (-not $git) {
  Write-Host @"
Git is not installed. Install it, then run this script again:

  winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
  winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements

Close and reopen the terminal after install, then:

  powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`"
"@
  exit 1
}

if (-not $gh) {
  Write-Host @"
GitHub CLI is not installed. Install it, then run this script again:

  winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements

Close and reopen the terminal after install, then:

  powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`"
"@
  exit 1
}

& $gh auth status
if ($LASTEXITCODE -ne 0) {
  Write-Host "Sign in to GitHub (browser window will open)..."
  & $gh auth login --hostname github.com --git-protocol https --web
  if ($LASTEXITCODE -ne 0) { throw "GitHub login failed." }
}

$login = (& $gh api user --jq .login).Trim()
if (-not $login) { throw "Could not read GitHub username." }

$email = (& $gh api user --jq .email).Trim()
if (-not $email -or $email -eq "null") { $email = "$login@users.noreply.github.com" }

if (-not (Test-Path (Join-Path $SiteDir ".git"))) {
  & $git init -b main
}

& $git add index.html .nojekyll .github
$status = & $git status --porcelain
if ($status) {
  & $git -c "user.name=$login" -c "user.email=$email" commit -m @"
Publish Miras privacy policy for app store listings.
"@
}

$existingRemote = & $git remote get-url origin 2>$null
if (-not $existingRemote) {
  & $gh repo create $RepoName --public --description "Miras (ميراس) privacy policy" --source $SiteDir --remote origin --push
} else {
  & $git push -u origin HEAD
}

$pagesEnabled = $true
& $gh api --method POST "repos/$login/$RepoName/pages" -f build_type=workflow 2>$null
if ($LASTEXITCODE -ne 0) {
  & $gh api --method POST "repos/$login/$RepoName/pages" -f "source[branch]=main" -f "source[path]=/" 2>$null
  if ($LASTEXITCODE -ne 0) { $pagesEnabled = $false }
}

& $gh api --method PUT "repos/$login/$RepoName/pages" -f build_type=workflow 2>$null | Out-Null

$liveUrl = "https://$login.github.io/$RepoName/"
Write-Host ""
Write-Host "Repository: https://github.com/$login/$RepoName"
Write-Host "Live URL:   $liveUrl"
Write-Host "English:    $liveUrl?lang=en"
Write-Host ""
Write-Host "Pages usually goes live within 1-2 minutes. Use the URL above in Google Play and App Store Connect."
if (-not $pagesEnabled) {
  Write-Host "If the site 404s: GitHub repo -> Settings -> Pages -> Source: GitHub Actions, then re-run the workflow from the Actions tab."
}
