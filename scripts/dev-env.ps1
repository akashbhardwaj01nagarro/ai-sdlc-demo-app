# Puts a user-local .NET SDK (installed with dotnet-install into ~\.dotnet) ahead of a
# machine-wide dotnet that has no SDK. Dot-source it in PowerShell:  . .\scripts\dev-env.ps1
# Does nothing on machines without ~\.dotnet (CI, machines with a system SDK).
$devEnvDotnetHome = Join-Path $env:USERPROFILE '.dotnet'
if (Test-Path (Join-Path $devEnvDotnetHome 'dotnet.exe')) {
    if (-not (($env:PATH -split ';') -contains $devEnvDotnetHome)) {
        $env:PATH = "$devEnvDotnetHome;$devEnvDotnetHome\tools;$env:PATH"
    }
    $env:DOTNET_ROOT = $devEnvDotnetHome
}
$env:DOTNET_NOLOGO = '1'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
Remove-Variable devEnvDotnetHome
