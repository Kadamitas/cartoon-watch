param([string]$PlatformToolsArchive)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'setup-tv.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw $errors[0] }
$definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$setupWorker' }, $true)
$expression = $definition.Right.Find({ param($node) $node -is [Management.Automation.Language.ScriptBlockExpressionAst] }, $true)
$worker = $expression.ScriptBlock.GetScriptBlock().ToString()
$workerAst = [Management.Automation.Language.Parser]::ParseInput($worker, [ref]$tokens, [ref]$errors)
$functions = @{}; $workerAst.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $functions[$_.Name] = $_.Extent.Text }
$mocks = @{
    Tools = "function Tools { return 'mock-adb.exe' }"
    Apk = "function Apk { return Join-Path `$repo 'outputs\Cartoon-Watch.apk' }"
    Run = @'
function Run($Executable, $Arguments, $InputText = '', $Timeout = 20000) {
    $Config.Calls.Add([pscustomobject]@{ Arguments = @($Arguments); HasInput = [bool]$InputText })
    $text = ''; $code = 0
    if ($Arguments[0] -eq 'devices') { $text = "List of devices attached`n$($Config.Address)`t$($Config.State)" }
    elseif ($Arguments -contains 'ro.product.model') { $text = 'Fixture TV' }
    elseif ($Arguments -contains 'ro.build.version.sdk') { $text = $Config.Api }
    elseif ($Arguments -contains 'install') { $text = $Config.InstallResult; if ($text -ne 'Success') { $code = 1 } }
    elseif ($Arguments[0] -eq 'pair') { $text = 'Successfully paired' }
    return [pscustomobject]@{ Code = $code; Text = $text }
}
'@
    Download = @'
function Download($Url, $Path, $Limit = 33554432) {
    $Config.Downloads.Add($Url)
    $bytes = [Text.Encoding]::ASCII.GetBytes('fixture APK, never executed')
    if ($Url.EndsWith('.sha256')) {
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $hash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
        [IO.File]::WriteAllText($Path, $hash + '  Cartoon-Watch.apk')
    } else { [IO.File]::WriteAllBytes($Path, $bytes) }
}
'@
}
function Config($Action) {
    $folder = Join-Path $root ('work\setup-smoke\case ' + [guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($folder)
    return [pscustomobject]@{ Root = $folder; Action = $Action; Address = '192.0.2.10:5555'; PairAddress = '192.0.2.10:37123'; PairCode = '123456'; State = 'device'; Api = '30'; InstallResult = 'Success'; Calls = (New-Object 'Collections.Generic.List[object]'); Downloads = (New-Object 'Collections.Generic.List[string]') }
}
function Flow($Config, [switch]$RealTools, [switch]$RealApk) {
    $script = $worker
    foreach ($name in @('Run', 'Download', 'Tools', 'Apk')) { if (($name -eq 'Tools' -and $RealTools) -or ($name -eq 'Apk' -and $RealApk)) { continue }; $script = $script.Replace($functions[$name], $mocks[$name]) }
    $power = [PowerShell]::Create(); [void]$power.AddScript($script).AddArgument($Config)
    try { $pending = $power.BeginInvoke(); if (-not $pending.AsyncWaitHandle.WaitOne(15000)) { $power.Stop(); throw 'Mock setup worker timed out' }; return @($power.EndInvoke($pending))[-1] } finally { $power.Dispose() }
}
$script:checks = 0
function Assert($Condition, $Message) { $script:checks++; if (-not $Condition) { throw $Message } }
$config = Config 'check'; $result = Flow $config; Assert $result.Success 'Connected TV check failed'; Assert ($result.Message -match 'Fixture TV.*API 30') 'Detected TV information missing'
$config = Config 'check'; $config.State = 'unauthorized'; $result = Flow $config; Assert (-not $result.Success -and $result.Message -match 'Allow USB debugging') 'Authorization instructions missing'; Assert (@($config.Calls | Where-Object { $_.Arguments[0] -eq 'connect' }).Count -eq 1) 'Unauthorized device was retried automatically'
$config = Config 'check'; $config.State = 'offline'; $result = Flow $config; Assert (-not $result.Success -and $result.Message -match 'not connected') 'Offline TV handling failed'
$config = Config 'check'; $config.Api = '22'; $result = Flow $config; Assert (-not $result.Success -and $result.Message -match 'too old') 'Old Android version was accepted'
$config = Config 'install'; $result = Flow $config; Assert $result.Success 'Mock installation failed'; $install = @($config.Calls | Where-Object { $_.Arguments -contains 'install' })[0]; Assert ($install.Arguments -contains '-r' -and $install.Arguments -contains '--no-incremental') 'Data-preserving install flags missing'; Assert (-not ($config.Calls.Arguments -contains 'uninstall' -or $config.Calls.Arguments -contains 'clear')) 'Installer attempted a reset'; Assert ($install.Arguments[-1].Contains('case ') -and $install.Arguments[-1].EndsWith('\outputs\Cartoon-Watch.apk')) 'APK path with spaces was not retained'
$config = Config 'install'; $config.InstallResult = 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]'; $result = Flow $config; Assert (-not $result.Success -and $result.Message -match 'different signing key') 'Signature mismatch not explained'; Assert (-not ($config.Calls.Arguments -contains 'uninstall')) 'Signature mismatch triggered uninstall'
$config = Config 'install'; $config.InstallResult = 'Failure [INSTALL_FAILED_VERSION_DOWNGRADE]'; $result = Flow $config; Assert (-not $result.Success -and $result.Message -match 'newer app version') 'Downgrade was not rejected'
$config = Config 'pair'; $result = Flow $config; Assert $result.Success 'Pairing flow failed'; $pair = @($config.Calls | Where-Object { $_.Arguments[0] -eq 'pair' })[0]; Assert ($pair.HasInput -and $pair.Arguments.Count -eq 2 -and $pair.Arguments -notcontains $config.PairCode) 'Pairing code must use private stdin'; Assert ($result.Message -notmatch $config.PairCode) 'Pairing code leaked into status'
$config = Config 'pair'; $config.PairCode = 'invalid'; $result = Flow $config; Assert (-not $result.Success -and $config.Calls.Count -eq 0) 'Invalid pairing code executed ADB'
$config = Config 'check'; $config.Address = '192.0.2.10:5555 & calc'; $result = Flow $config; Assert (-not $result.Success -and $config.Calls.Count -eq 0) 'Unsafe target was accepted'
$config = Config 'check'; $result = Flow $config -RealTools; Assert (-not $result.Success -and $result.Message -match 'Google tools checksum') 'Unverified ADB archive was accepted'; Assert ($config.Calls.Count -eq 0) 'Unverified ADB was executed'
$config = Config 'install'; [void][IO.Directory]::CreateDirectory((Join-Path $config.Root 'outputs')); [IO.File]::WriteAllText((Join-Path $config.Root 'outputs\Cartoon-Watch.apk'), 'fixture APK'); [IO.File]::WriteAllText((Join-Path $config.Root 'outputs\Cartoon-Watch.apk.sha256'), ('0' * 64) + '  Cartoon-Watch.apk'); $result = Flow $config -RealApk; Assert (-not $result.Success -and $result.Message -match 'local APK checksum') 'Bad local APK checksum accepted'; Assert (@($config.Calls | Where-Object { $_.Arguments -contains 'install' }).Count -eq 0) 'Unverified APK was installed'
$config = Config 'install'; $result = Flow $config -RealApk; Assert $result.Success 'Verified release download flow failed'; Assert ($config.Downloads.Count -eq 2 -and @($config.Downloads | Where-Object { $_ -notlike 'https://github.com/Kadamitas/cartoon-watch/releases/latest/download/Cartoon-Watch.apk*' }).Count -eq 0) 'Release download used an unexpected source'
if ($PlatformToolsArchive) { $config = Config 'check'; $cache = Join-Path $config.Root 'work\setup'; [void][IO.Directory]::CreateDirectory($cache); Copy-Item -LiteralPath $PlatformToolsArchive -Destination (Join-Path $cache 'platform-tools-r37.0.3-win.zip'); $result = Flow $config -RealTools; Assert $result.Success 'Official platform-tools extraction failed'; Assert (Test-Path -LiteralPath (Join-Path $cache 'platform-tools\adb.exe')) 'Verified ADB executable missing'; Assert ($config.Downloads.Count -eq 0) 'Verified cached tools were downloaded again' }
Write-Output "Mock setup worker checks passed: $script:checks. No TV connections or installs were performed."
