[CmdletBinding()]
param(
    [string]$SdkRoot = '',
    [switch]$ToolsOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($SdkRoot)) { $SdkRoot = Join-Path $projectRoot 'work\android-sdk' }
$workRoot = Join-Path $projectRoot 'work'
$downloadRoot = Join-Path $workRoot 'downloads'
$libraryRoot = Join-Path $workRoot 'libs'
$buildRoot = Join-Path $workRoot 'build'
$outputRoot = Join-Path $projectRoot 'outputs'
New-Item -ItemType Directory -Force -Path $workRoot,$downloadRoot,$libraryRoot,$SdkRoot,$buildRoot,$outputRoot | Out-Null

function Get-VerifiedDownload {
    param([string]$Url, [string]$Destination, [string]$Sha256)
    if (!(Test-Path -LiteralPath $Destination) -or (Get-FileHash -Algorithm SHA256 -LiteralPath $Destination).Hash -ne $Sha256) {
        Write-Host "Downloading $([IO.Path]::GetFileName($Destination))"
        Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
    }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $Destination).Hash -ne $Sha256) {
        throw "Checksum mismatch: $Destination"
    }
}

function Invoke-BuildCommand {
    param([string]$Executable, [string[]]$CommandArguments)
    & $Executable @CommandArguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE" }
}

$buildTools = Join-Path $SdkRoot 'build-tools\android-15'
$androidJar = Join-Path $SdkRoot 'platforms\android-35\android.jar'
$adbPath = Join-Path $SdkRoot 'platform-tools\adb.exe'
$jsoupJar = Join-Path $libraryRoot 'jsoup-1.18.3.jar'
$webkitArchive = Join-Path $downloadRoot 'webkit-1.12.1.aar'
$webkitJar = Join-Path $libraryRoot 'webkit-1.12.1.jar'
if (!(Test-Path -LiteralPath (Join-Path $buildTools 'aapt2.exe'))) {
    $archive = Join-Path $downloadRoot 'build-tools35.zip'
    Get-VerifiedDownload 'https://dl.google.com/android/repository/build-tools_r35_windows.zip' $archive '5753C679A1B90BCF6FBC9945A2CE39DFB9E74F1DF0831A1E1866AE5B594326F0'
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $SdkRoot 'build-tools') -Force
}
if (!(Test-Path -LiteralPath $androidJar)) {
    $archive = Join-Path $downloadRoot 'platform35.zip'
    Get-VerifiedDownload 'https://dl.google.com/android/repository/platform-35_r02.zip' $archive '0988CACAD01B38A18A47BAC14A0695F246BC76C1B06C0EEB8EB0DC825AB0C8E0'
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $SdkRoot 'platforms') -Force
}
if (!(Test-Path -LiteralPath $adbPath)) {
    $archive = Join-Path $downloadRoot 'platform-tools.zip'
    Get-VerifiedDownload 'https://dl.google.com/android/repository/platform-tools_r37.0.3-win.zip' $archive 'B5D2015F5D5B7A24A2AC646A245F20F63FB501E4174C61863C74BED1DF6DE4BD'
    Expand-Archive -LiteralPath $archive -DestinationPath $SdkRoot -Force
}
Get-VerifiedDownload 'https://repo.maven.apache.org/maven2/org/jsoup/jsoup/1.18.3/jsoup-1.18.3.jar' $jsoupJar '5BE1CCD3228AE5FD6EED1BD6D827BAC2BC65B91C20E9957D16EA65F739F15302'
Get-VerifiedDownload 'https://dl.google.com/dl/android/maven2/androidx/webkit/webkit/1.12.1/webkit-1.12.1.aar' $webkitArchive '18A0A51AD129E0C8563F031D46C8A7E61169F56AE84E562A0D75686941262111'


if (!(Test-Path -LiteralPath $webkitJar) -or (Get-FileHash -Algorithm SHA256 -LiteralPath $webkitJar).Hash -ne 'B03291B19348FDB4E7C5A97B316A19D71A583F45E68FD2B9EA2EA0A867E25CAD') {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $webkitZip = [IO.Compression.ZipFile]::OpenRead($webkitArchive)
    try {
        $webkitEntry = $webkitZip.GetEntry('classes.jar')
        if ($null -eq $webkitEntry) { throw 'WebKit archive is missing classes.jar.' }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($webkitEntry, $webkitJar, $true)
    } finally { $webkitZip.Dispose() }
}
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $webkitJar).Hash -ne 'B03291B19348FDB4E7C5A97B316A19D71A583F45E68FD2B9EA2EA0A867E25CAD') { throw 'WebKit classes checksum mismatch.' }
if ($ToolsOnly) {
    Write-Host "Android SDK35 and build tools ready. ADB: $adbPath"
    exit 0
}


$keyStore = Join-Path $workRoot 'CartoonWatch-debug.keystore'
$javaCommand = (Get-Command java -ErrorAction Stop).Source
$javaProbe = [Diagnostics.ProcessStartInfo]::new()
$javaProbe.FileName = $javaCommand
$javaProbe.Arguments = '-XshowSettings:properties -version'
$javaProbe.UseShellExecute = $false
$javaProbe.CreateNoWindow = $true
$javaProbe.RedirectStandardOutput = $true
$javaProbe.RedirectStandardError = $true
$javaProcess = [Diagnostics.Process]::Start($javaProbe)
$javaStdout = $javaProcess.StandardOutput.ReadToEndAsync()
$javaStderr = $javaProcess.StandardError.ReadToEndAsync()
$javaProcess.WaitForExit()
$javaSettings = $javaStdout.Result + "`n" + $javaStderr.Result
if ($javaProcess.ExitCode -ne 0) { throw 'Java installation could not be inspected.' }
$javaProcess.Dispose()
if ($javaSettings -notmatch '(?m)^\s*java\.home\s*=\s*(.+)\s*$') { throw 'Cannot identify the JDK home directory.' }
$jdkBin = Join-Path $Matches[1].Trim() 'bin'
$javacCommand = Join-Path $jdkBin 'javac.exe'
$jarCommand = Join-Path $jdkBin 'jar.exe'
$keytoolCommand = Join-Path $jdkBin 'keytool.exe'
foreach ($commandPath in @($javacCommand,$jarCommand,$keytoolCommand)) {
    if (!(Test-Path -LiteralPath $commandPath)) { throw "A full JDK is required; missing $commandPath" }
}
if (!(Test-Path -LiteralPath $keyStore)) {
    Invoke-BuildCommand $keytoolCommand @('-genkeypair','-keystore',$keyStore,'-storepass','android','-keypass','android','-alias','cartoonwatch','-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=Cartoon Watch Local Development, O=Cartoon Watch, C=US')
}


$resolvedBuild = [IO.Path]::GetFullPath($buildRoot).TrimEnd('\')
$expectedBuild = [IO.Path]::GetFullPath((Join-Path $projectRoot 'work\build')).TrimEnd('\')
if ($resolvedBuild -ne $expectedBuild) { throw 'Build directory is outside the expected project workspace.' }
if (Test-Path -LiteralPath $resolvedBuild) { Remove-Item -LiteralPath $resolvedBuild -Recurse -Force }
$classRoot = Join-Path $buildRoot 'classes'
$generatedRoot = Join-Path $buildRoot 'generated'
$dexRoot = Join-Path $buildRoot 'dex'
New-Item -ItemType Directory -Force -Path $buildRoot,$classRoot,$generatedRoot,$dexRoot | Out-Null
$resourceRoot = Join-Path $projectRoot 'app\src\main\res'
$assetRoot = Join-Path $projectRoot 'app\src\main\assets'
$manifest = Join-Path $projectRoot 'app\src\main\AndroidManifest.xml'
$compiledResources = Join-Path $buildRoot 'resources.zip'
$unsignedApk = Join-Path $buildRoot 'Cartoon-Watch-unsigned.apk'
$alignedApk = Join-Path $buildRoot 'Cartoon-Watch-aligned.apk'
$finalApk = Join-Path $outputRoot 'Cartoon-Watch.apk'

Write-Host 'Compiling Android resources'
Invoke-BuildCommand (Join-Path $buildTools 'aapt2.exe') @('compile','--dir',$resourceRoot,'-o',$compiledResources)
Invoke-BuildCommand (Join-Path $buildTools 'aapt2.exe') @('link','-o',$unsignedApk,'-I',$androidJar,'--manifest',$manifest,'--java',$generatedRoot,'-A',$assetRoot,$compiledResources)

Write-Host 'Compiling Java sources'
$sourceFiles = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'app\src\main\java') -Filter '*.java' -Recurse | ForEach-Object FullName)
$sourceFiles += @(Get-ChildItem -LiteralPath $generatedRoot -Filter '*.java' -Recurse | ForEach-Object FullName)
if ($sourceFiles.Count -eq 0) { throw 'No Java source files were found.' }
$sourceList = Join-Path $buildRoot 'sources.txt'
$quotedSources = $sourceFiles | ForEach-Object { '"' + $_.Replace('\','/') + '"' }
[IO.File]::WriteAllLines($sourceList, $quotedSources, [Text.UTF8Encoding]::new($false))
$bootClasspath = $androidJar + ';' + (Join-Path $buildTools 'core-lambda-stubs.jar')
$dependencyClasspath = $jsoupJar + ';' + $webkitJar
Invoke-BuildCommand $javacCommand @('-encoding','UTF-8','-source','8','-target','8','-bootclasspath',$bootClasspath,'-classpath',$dependencyClasspath,'-d',$classRoot,"@$sourceList")
$classesJar = Join-Path $buildRoot 'classes.jar'
Invoke-BuildCommand $jarCommand @('cf',$classesJar,'-C',$classRoot,'.')

Write-Host 'Converting bytecode and packaging APK'
Invoke-BuildCommand $javaCommand @('-cp',(Join-Path $buildTools 'lib\d8.jar'),'com.android.tools.r8.D8','--min-api','23','--lib',$androidJar,'--output',$dexRoot,$classesJar,$jsoupJar,$webkitJar)
$dexFiles = @(Get-ChildItem -LiteralPath $dexRoot -Filter '*.dex' | ForEach-Object Name)
if ($dexFiles.Count -eq 0) { throw 'D8 produced no dex files.' }
foreach ($dexFile in $dexFiles) { Invoke-BuildCommand $jarCommand @('uf',$unsignedApk,'-C',$dexRoot,$dexFile) }
Invoke-BuildCommand (Join-Path $buildTools 'zipalign.exe') @('-p','-f','4',$unsignedApk,$alignedApk)
Invoke-BuildCommand $javaCommand @('-jar',(Join-Path $buildTools 'lib\apksigner.jar'),'sign','--ks',$keyStore,'--ks-key-alias','cartoonwatch','--ks-pass','pass:android','--key-pass','pass:android','--v1-signing-enabled','true','--v2-signing-enabled','true','--out',$finalApk,$alignedApk)
Invoke-BuildCommand $javaCommand @('-jar',(Join-Path $buildTools 'lib\apksigner.jar'),'verify','--verbose',$finalApk)
Invoke-BuildCommand (Join-Path $buildTools 'zipalign.exe') @('-c','4',$finalApk)
$apkHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $finalApk).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $outputRoot 'Cartoon-Watch.apk.sha256'), "$apkHash  Cartoon-Watch.apk`n", [Text.UTF8Encoding]::new($false))
Write-Host "Built $finalApk"
