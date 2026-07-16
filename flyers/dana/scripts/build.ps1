$ErrorActionPreference = "Stop"

$FlyerRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$RepoRoot = Resolve-Path (Join-Path $FlyerRoot "..\..")

function Get-FirstExistingCommand {
  param([string[]]$Candidates)

  foreach ($Candidate in $Candidates) {
    if ([string]::IsNullOrWhiteSpace($Candidate)) {
      continue
    }

    if (Test-Path -LiteralPath $Candidate) {
      return $Candidate
    }

    $Command = Get-Command $Candidate -ErrorAction SilentlyContinue
    if ($Command) {
      return $Command.Source
    }
  }

  throw "None of these commands were found: $($Candidates -join ', ')"
}

$Python = Get-FirstExistingCommand @(
  (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"),
  "python"
)

function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments)

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $Command $($Arguments -join ' ')"
  }
}

Push-Location $RepoRoot
try {
  Invoke-Checked $Python @("flyers\dana\scripts\make_qr.py")
  Invoke-Checked $Python @("flyers\dana\scripts\render_flyer.py")
}
finally {
  Pop-Location
}
