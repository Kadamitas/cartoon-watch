param([switch]$SelfTest, [string]$Preview)

$ErrorActionPreference = 'Stop'
$setupWorker = {
    param($Config)
    $ErrorActionPreference = 'Stop'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Add-Type -AssemblyName System.Net.Http
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $repo = [IO.Path]::GetFullPath($Config.Root)
    $directory = [IO.Path]::GetFullPath((Join-Path $repo 'work\setup'))
    function Status($Message) { Write-Progress -Activity $Message -Status 'Please wait' }
    function Address($Value) {
        if ($Value -notmatch '^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}$') { return $false }
        $parts = $Value.Split(':'); $ip = $null
        return [Net.IPAddress]::TryParse($parts[0], [ref]$ip) -and $ip.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and $ip.ToString() -eq $parts[0] -and [int]$parts[1] -ge 1 -and [int]$parts[1] -le 65535
    }
    function Safe-Entry($Folder, $Name) {
        if ([IO.Path]::IsPathRooted($Name) -or $Name.Contains(':') -or ($Name -split '[\\/]') -contains '..') { throw 'The tools archive contains an unsafe path.' }
        $base = [IO.Path]::GetFullPath($Folder).TrimEnd('\') + '\'
        $target = [IO.Path]::GetFullPath((Join-Path $Folder $Name))
        if (-not $target.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw 'The tools archive contains an unsafe path.' }
        for ($parent = $target; $parent.Length -ge $base.Length; $parent = [IO.Path]::GetDirectoryName($parent)) {
            if ((Test-Path -LiteralPath $parent) -and ((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Use a regular folder for setup, without linked folders inside work/setup.' }
        }
        return $target
    }
    function Hash($Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
    function Expected-Hash($Text) {
        if ($Text -notmatch '^\s*([a-fA-F0-9]{64})(?:\s+\*?Cartoon-Watch\.apk)?\s*$') { throw 'The release checksum could not be read. Nothing was installed.' }
        return $Matches[1].ToLowerInvariant()
    }
    function Download($Url, $Path, $Limit = 33554432) {
        $client = New-Object Net.Http.HttpClient
        $client.Timeout = [TimeSpan]::FromSeconds(45); $client.MaxResponseContentBufferSize = $Limit
        $partial = Safe-Entry ([IO.Path]::GetDirectoryName($Path)) ([IO.Path]::GetFileName($Path) + '.download')
        try { $bytes = $client.GetByteArrayAsync($Url).GetAwaiter().GetResult(); [IO.File]::WriteAllBytes($partial, $bytes); Move-Item -LiteralPath $partial -Destination $Path -Force }
        catch { throw 'The download could not finish. Check your internet connection and try this step again.' }
        finally { $client.Dispose() }
    }
    function Tools {
        Status 'Downloading or checking official Google ADB tools'
        $archive = Safe-Entry $directory 'platform-tools-r37.0.3-win.zip'
        $expected = 'b5d2015f5d5b7a24a2ac646a245f20f63fb501e4174c61863c74bed1df6de4bd'
        if (-not (Test-Path -LiteralPath $archive) -or (Hash $archive) -ne $expected) { Download 'https://dl.google.com/android/repository/platform-tools_r37.0.3-win.zip' $archive }
        if ((Hash $archive) -ne $expected) { throw 'The Google tools checksum did not match. Nothing was installed.' }
        $zip = [IO.Compression.ZipFile]::OpenRead($archive)
        try {
            $size = 0L
            if ($zip.Entries.Count -gt 256) { throw 'The tools archive contains too many files.' }
            foreach ($entry in $zip.Entries) {
                $size += $entry.Length
                if (-not $entry.FullName.StartsWith('platform-tools/') -or $size -gt 83886080 -or $entry.Length -gt 33554432 -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'The tools archive is not an expected Google platform-tools package.' }
                $target = Safe-Entry $directory $entry.FullName
                if ($entry.FullName.EndsWith('/')) { [void][IO.Directory]::CreateDirectory($target); continue }
                [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
                $archiveStream = $entry.Open(); $sha = [Security.Cryptography.SHA256]::Create()
                try { $digest = [BitConverter]::ToString($sha.ComputeHash($archiveStream)).Replace('-', '').ToLowerInvariant() } finally { $archiveStream.Dispose(); $sha.Dispose() }
                if (-not (Test-Path -LiteralPath $target) -or (Hash $target) -ne $digest) { [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true) }
            }
        } finally { $zip.Dispose() }
        return Safe-Entry $directory 'platform-tools\adb.exe'
    }
    function Run($Executable, $Arguments, $InputText = '', $Timeout = 20000) {
        $info = New-Object Diagnostics.ProcessStartInfo
        $info.FileName = $Executable; $info.Arguments = ($Arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join ' '
        $info.UseShellExecute = $false; $info.CreateNoWindow = $true; $info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
        $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true; $info.RedirectStandardInput = $true
        $process = New-Object Diagnostics.Process; $process.StartInfo = $info
        try {
            [void]$process.Start(); $output = $process.StandardOutput.ReadToEndAsync(); $errors = $process.StandardError.ReadToEndAsync()
            if ($InputText) { $process.StandardInput.WriteLine($InputText) }; $process.StandardInput.Close()
            if (-not $process.WaitForExit($Timeout)) { $process.Kill(); throw 'This step took too long. Check the TV screen and address, then try again.' }
            if (-not $output.Wait(2000) -or -not $errors.Wait(2000)) { throw 'ADB did not finish responding. Try this step again.' }
            return [pscustomobject]@{ Code = $process.ExitCode; Text = ($output.Result + "`n" + $errors.Result).Trim() }
        } finally { $process.Dispose() }
    }
    function Connect($Adb, $Serial) {
        Status 'Connecting to your TV; watch its screen for an Allow prompt'
        $null = Run $Adb @('connect', $Serial)
        $devices = Run $Adb @('devices', '-l')
        $match = [regex]::Match($devices.Text, '(?m)^' + [regex]::Escape($Serial) + '\s+(device|unauthorized|offline)\b')
        if ($match.Groups[1].Value -eq 'unauthorized') { throw 'On the TV, choose Allow USB debugging. Then click Check / Connect again.' }
        if ($match.Groups[1].Value -ne 'device') { throw 'The TV is not connected. Keep it awake, check its address and port, and use the same home network. Google TV wireless debugging may need pairing first. Then click Check / Connect again.' }
        $model = Run $Adb @('-s', $Serial, 'shell', 'getprop', 'ro.product.model')
        $api = Run $Adb @('-s', $Serial, 'shell', 'getprop', 'ro.build.version.sdk')
        if ($model.Code -ne 0 -or $api.Code -ne 0 -or $api.Text -notmatch '^[0-9]+$') { throw 'The TV did not return its device information. Click Check / Connect again.' }
        if ([int]$api.Text -lt 23) { throw 'This TV version is too old for Cartoon Watch. Android 6 / API 23 or newer is required.' }
        return $model.Text + ' (Android API ' + $api.Text + ')'
    }
    function Apk {
        $local = Join-Path $repo 'outputs\Cartoon-Watch.apk'
        if (Test-Path -LiteralPath $local) {
            if ((Test-Path -LiteralPath ($local + '.sha256')) -and (Hash $local) -ne (Expected-Hash ([IO.File]::ReadAllText($local + '.sha256')))) { throw 'The local APK checksum did not match. Rebuild it or download the official release.' }
            Status 'Using the Cartoon Watch APK built in this folder'; return $local
        }
        Status 'Downloading Cartoon Watch from its official GitHub release'
        $base = 'https://github.com/Kadamitas/cartoon-watch/releases/latest/download/Cartoon-Watch.apk'
        $apk = Safe-Entry $directory 'Cartoon-Watch.apk'; $checksum = Safe-Entry $directory 'Cartoon-Watch.apk.sha256'
        Download ($base + '.sha256') $checksum 4096
        $expected = Expected-Hash ([IO.File]::ReadAllText($checksum))
        if (-not (Test-Path -LiteralPath $apk) -or (Hash $apk) -ne $expected) { Download $base $apk }
        if ((Hash $apk) -ne $expected) { throw 'The app download checksum did not match. Nothing was installed. Try again.' }
        return $apk
    }
    try {
        if ($Config.Action -eq 'selftest') {
            $checks = 0
            foreach ($case in @(@('192.0.2.10:5555', $true), @('192.0.2.10:37123', $true), @('192.0.2.999:5555', $false), @('127.0.0.1:0', $false), @('192.0.2.10:65536', $false), @('192.0.2.10;whoami:5555', $false))) { if ((Address $case[0]) -ne $case[1]) { throw 'Address validation failed' }; $checks++ }
            foreach ($name in @('..\escape.exe', 'platform-tools/../../escape.exe', 'C:\escape.exe', 'platform-tools/a:stream')) { $rejected = $false; try { $null = Safe-Entry $directory $name } catch { $rejected = $true }; if (-not $rejected) { throw 'ZIP path validation failed' }; $checks++ }
            $null = Safe-Entry $directory 'platform-tools/adb.exe'; $null = Expected-Hash (('a' * 64) + '  Cartoon-Watch.apk')
            $probe = Run (Join-Path $env:SystemRoot 'System32\where.exe') @('cmd.exe')
            if ($probe.Code -ne 0 -or $probe.Text -notmatch '(?i)\\cmd\.exe$') { throw 'Background process test failed' }
            return [pscustomobject]@{ Success = $true; Message = "Setup helper checks passed: $($checks + 3)" }
        }
        $serial = $Config.Address.Trim()
        if ($Config.Action -eq 'pair') {
            if (-not (Address $Config.PairAddress) -or $Config.PairCode -notmatch '^[0-9]{6}$') { throw 'Enter the pairing IPv4:port and the six-digit pairing code shown on Google TV.' }
        } elseif (-not (Address $serial)) { throw 'Enter your TV IPv4 address and connect port, such as 192.0.2.10:5555. Use the actual values shown on your TV.' }
        $null = Safe-Entry $repo 'work\setup\check'; $null = Safe-Entry (Join-Path $repo 'work') 'setup\check'
        [void][IO.Directory]::CreateDirectory($directory)
        $adb = Tools
        if ($Config.Action -eq 'pair') {
            Status 'Pairing with Google TV'
            $result = Run $adb @('pair', $Config.PairAddress) $Config.PairCode
            if ($result.Code -ne 0 -or $result.Text -notmatch '(?i)successfully paired') { throw 'Pairing did not finish. Keep the pairing-code screen open and check its address, port, and code. Then click Pair Google TV again.' }
            return [pscustomobject]@{ Success = $true; Message = 'Paired. Enter the main Wireless debugging connect address above, then click Check / Connect.' }
        }
        $device = Connect $adb $serial
        if ($Config.Action -eq 'check') { return [pscustomobject]@{ Success = $true; Message = "Connected to $device. Ready to install Cartoon Watch." } }
        $apk = Apk; Status "Installing Cartoon Watch on $device"
        $installed = Run $adb @('-s', $serial, 'install', '-r', '--no-incremental', $apk) '' 60000
        if ($installed.Text -match 'INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match') { throw 'The existing app uses a different signing key. Nothing was erased. Use an APK signed by the original developer or ask the person who set it up.' }
        if ($installed.Text -match 'INSTALL_FAILED_VERSION_DOWNGRADE') { throw 'Your TV already has a newer app version. Nothing was erased. Use the latest release or keep the installed version.' }
        if ($installed.Code -ne 0 -or $installed.Text -notmatch '(?m)^Success\s*$') { throw ('Installation did not finish. Nothing was reset. ADB reported: ' + $installed.Text.Substring(0, [Math]::Min(600, $installed.Text.Length))) }
        $opened = Run $adb @('-s', $serial, 'shell', 'am', 'start', '-n', 'tv.cartoonwatch.app/.MainActivity')
        return [pscustomobject]@{ Success = $true; Message = 'Installed! Cartoon Watch is ready in your TV apps menu. Existing settings and watch history were kept. You can turn ADB debugging off when finished.' }
    } catch { return [pscustomobject]@{ Success = $false; Message = $_.Exception.Message } }
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object Windows.Forms.Form
$area = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.Text = 'Cartoon Watch - TV Setup'; $form.StartPosition = 'CenterScreen'; $form.Size = New-Object Drawing.Size([Math]::Min(780, $area.Width - 32), [Math]::Min(780, $area.Height - 32)); $form.MinimumSize = New-Object Drawing.Size([Math]::Min(640, $area.Width - 32), [Math]::Min(600, $area.Height - 32))
$form.Font = New-Object Drawing.Font('Segoe UI', 10); $form.AutoScaleMode = 'Dpi'
$layout = New-Object Windows.Forms.TableLayoutPanel; $layout.Dock = 'Fill'; $layout.AutoScroll = $true; $layout.ColumnCount = 1; $layout.RowCount = 0; $layout.Padding = New-Object Windows.Forms.Padding(20)
$form.Controls.Add($layout)
function Label($Text) { $label = New-Object Windows.Forms.Label; $label.Text = $Text; $label.AutoSize = $true; $label.MaximumSize = New-Object Drawing.Size(700, 0); return $label }
$title = Label 'Put Cartoon Watch on your TV'; $title.Font = New-Object Drawing.Font('Segoe UI', 18, [Drawing.FontStyle]::Bold)
$intro = Label 'Fire TV and Android / Google TV. Keep your TV awake and use the same home network as this computer. No developer tools or administrator account needed.'
$platform = New-Object Windows.Forms.ComboBox; $platform.DropDownStyle = 'DropDownList'; [void]$platform.Items.AddRange(@('Fire TV', 'Android / Google TV')); $platform.SelectedIndex = 0
$help = New-Object Windows.Forms.TextBox; $help.Multiline = $true; $help.ReadOnly = $true; $help.Height = 140; $help.ScrollBars = 'Vertical'; $help.BackColor = $form.BackColor; $help.BorderStyle = 'None'
$addressLabel = Label 'TV address (IPv4:connect port)'
$address = New-Object Windows.Forms.TextBox
$pairBox = New-Object Windows.Forms.GroupBox; $pairBox.Text = 'Google TV wireless pairing (only when your TV asks for it)'; $pairBox.Height = 105
$pairRow = New-Object Windows.Forms.FlowLayoutPanel; $pairRow.Dock = 'Fill'; $pairRow.Padding = New-Object Windows.Forms.Padding(8, 8, 8, 0)
$pairAddress = New-Object Windows.Forms.TextBox; $pairAddress.Width = 220
$pairCode = New-Object Windows.Forms.TextBox; $pairCode.Width = 85; $pairCode.UseSystemPasswordChar = $true; $pairCode.MaxLength = 6
$pairButton = New-Object Windows.Forms.Button; $pairButton.Text = 'Pair Google TV'; $pairButton.Width = 145; $pairButton.Height = 32
$pairRow.Controls.Add((Label 'Pairing IPv4:port')); $pairRow.Controls.Add($pairAddress); $pairRow.Controls.Add((Label 'Code')); $pairRow.Controls.Add($pairCode); $pairRow.Controls.Add($pairButton); $pairBox.Controls.Add($pairRow)
$buttons = New-Object Windows.Forms.FlowLayoutPanel; $buttons.AutoSize = $true
$check = New-Object Windows.Forms.Button; $check.Text = 'Check / Connect'; $check.Width = 165; $check.Height = 38
$install = New-Object Windows.Forms.Button; $install.Text = 'Install Cartoon Watch'; $install.Width = 200; $install.Height = 38; $install.Enabled = $false
$close = New-Object Windows.Forms.Button; $close.Text = 'Close'; $close.Width = 90; $close.Height = 38
$buttons.Controls.AddRange(@($check, $install, $close))
$status = New-Object Windows.Forms.TextBox; $status.Multiline = $true; $status.ReadOnly = $true; $status.ScrollBars = 'Vertical'; $status.Height = 135; $status.Text = 'Follow the TV instructions above, enter its address, then click Check / Connect.'
$footer = Label 'Only official Google ADB tools and the Cartoon Watch GitHub release are downloaded. Checksums check file integrity; they are not a guarantee against malware. Roku, LG, Samsung, and Apple TV do not use this installer.'
foreach ($control in @($title, $intro, $platform, $help, $addressLabel, $address, $pairBox, $buttons, $status, $footer)) { $layout.RowCount++; [void]$layout.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize'))); $control.Dock = 'Top'; $control.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 10); $layout.Controls.Add($control, 0, $layout.RowCount - 1) }
$script:setupJob = $null; $script:checkedAddress = ''; $script:setupRoot = $PSScriptRoot
function Instructions {
    $google = $platform.SelectedIndex -eq 1; $pairBox.Visible = $google; $install.Enabled = $false; $script:checkedAddress = ''
    if ($google) { $help.Text = "1. TV Settings > System (or Device Preferences) > About: select Android TV OS build / Build seven times.`r`n2. Open Developer Options and enable Wireless debugging, or the TV's ADB/network debugging option.`r`n3. For Wireless debugging, choose Pair device with pairing code and use the optional fields below. Then use the main Wireless debugging IP:port as the TV address above.`r`n4. Allow this computer on the TV when asked, then click Check / Connect again." }
    else { $help.Text = "1. TV Settings > My Fire TV (or Device & Software) > About. If Developer Options is hidden, select the TV/device name seven times.`r`n2. Open Developer Options and enable ADB Debugging.`r`n3. Find the TV IP address under About > Network. Enter that address followed by :5555 below.`r`n4. Click Check / Connect, choose Allow USB debugging on the TV, then click Check / Connect again." }
}
function Append-Status($Message) { if ($status.TextLength -gt 16000) { $status.Text = $status.Text.Substring($status.TextLength - 8000) }; $status.AppendText("`r`n`r`n" + $Message) }
function Start-Setup($Action) {
    if ($script:setupJob) { return }
    if ($Action -ne 'install') { $script:checkedAddress = '' }
    $config = [pscustomobject]@{ Action = $Action; Root = $script:setupRoot; Address = $address.Text.Trim(); PairAddress = $pairAddress.Text.Trim(); PairCode = $pairCode.Text }
    $power = [PowerShell]::Create(); [void]$power.AddScript($setupWorker.ToString()).AddArgument($config)
    $script:setupJob = [pscustomobject]@{ Power = $power; Handle = $power.BeginInvoke(); Progress = 0; Action = $Action; Address = $config.Address }
    $pairCode.Clear(); $check.Enabled = $false; $install.Enabled = $false; $pairButton.Enabled = $false; $pairAddress.Enabled = $false; $pairCode.Enabled = $false; $platform.Enabled = $false; $address.Enabled = $false; Append-Status 'Working...'
}
$timer = New-Object Windows.Forms.Timer; $timer.Interval = 200
$timer.Add_Tick({
    $job = $script:setupJob; if (-not $job) { return }
    while ($job.Progress -lt $job.Power.Streams.Progress.Count) { Append-Status $job.Power.Streams.Progress[$job.Progress].Activity; $job.Progress++ }
    if (-not $job.Handle.IsCompleted) { return }
    try { $answer = @($job.Power.EndInvoke($job.Handle))[-1]; Append-Status $answer.Message; if ($answer.Success -and $job.Action -eq 'check') { $script:checkedAddress = $job.Address } }
    catch { Append-Status 'Setup could not complete this step. Check the TV screen and try again.' }
    finally { $job.Power.Dispose(); $script:setupJob = $null; $check.Enabled = $true; $pairButton.Enabled = $true; $pairAddress.Enabled = $true; $pairCode.Enabled = $true; $platform.Enabled = $true; $address.Enabled = $true; $install.Enabled = $script:checkedAddress -eq $address.Text.Trim() -and $script:checkedAddress -ne '' }
})
$platform.Add_SelectedIndexChanged({ Instructions }); $address.Add_TextChanged({ $script:checkedAddress = ''; $install.Enabled = $false })
$check.Add_Click({ Start-Setup 'check' }); $install.Add_Click({ Start-Setup 'install' }); $pairButton.Add_Click({ Start-Setup 'pair' }); $close.Add_Click({ $form.Close() })
$form.Add_FormClosing({ param($sender, $event); if ($script:setupJob) { $event.Cancel = $true; Append-Status 'Please wait for the current step to finish before closing.' } })
$form.Add_FormClosed({ $timer.Stop(); $timer.Dispose() })
$form.Add_Shown({ $space = [Windows.Forms.Screen]::FromControl($form).WorkingArea; $form.Height = [Math]::Min($form.Height, $space.Height - 32); $form.Width = [Math]::Min($form.Width, $space.Width - 32) })
$form.AcceptButton = $check; $form.CancelButton = $close
Instructions
if ($SelfTest) {
    $power = [PowerShell]::Create(); [void]$power.AddScript($setupWorker.ToString()).AddArgument([pscustomobject]@{ Root = $PSScriptRoot; Action = 'selftest' })
    try { $result = @($power.Invoke())[-1]; if (-not $result.Success) { throw $result.Message }; Write-Output $result.Message } finally { $power.Dispose() }
}
if ($SelfTest -or $Preview) {
    $form.StartPosition = 'Manual'; $form.Location = New-Object Drawing.Point(([Windows.Forms.SystemInformation]::VirtualScreen.Right + 100), 100); $form.Show(); [Windows.Forms.Application]::DoEvents()
    try {
        if ($install.Enabled -or $pairBox.Visible) { throw 'Initial setup controls are incorrect' }
        if ($Preview) { $renderPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $Preview)); if (-not $renderPath.StartsWith(([IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Preview must be saved inside this project folder.' }; [void][IO.Directory]::CreateDirectory($renderPath) }
        foreach ($index in @(0, 1)) {
            $platform.SelectedIndex = $index; [Windows.Forms.Application]::DoEvents()
            if ($index -eq 1 -and (-not $pairBox.Visible -or -not $pairCode.UseSystemPasswordChar)) { throw 'Google TV pairing controls were not enabled' }
            if ($Preview) { $bitmap = New-Object Drawing.Bitmap($form.Width, $form.Height); try { $form.DrawToBitmap($bitmap, (New-Object Drawing.Rectangle(0, 0, $form.Width, $form.Height))); $bitmap.Save((Join-Path $renderPath (@('Fire-TV-Setup.png', 'Google-TV-Setup.png')[$index])), [Drawing.Imaging.ImageFormat]::Png) } finally { $bitmap.Dispose() } }
        }
    } finally { $form.Dispose() }
    Write-Output 'Windows Forms setup layout checks passed'; exit 0
}
$timer.Start()
[Windows.Forms.Application]::Run($form)
