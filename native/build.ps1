$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$framework = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319'
$icon = Join-Path $PSScriptRoot 'AfterHours.ico'
if (!(Test-Path -LiteralPath $icon)) { throw 'Application icon is missing: ' + $icon }
$refs = @('System.dll','System.Core.dll','System.Web.Extensions.dll','System.Security.dll','System.Xaml.dll','WPF\System.Speech.dll','WPF\WindowsBase.dll','WPF\PresentationCore.dll','WPF\PresentationFramework.dll') | ForEach-Object { '/reference:' + (Join-Path $framework $_) }
$sources = Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.cs' | ForEach-Object FullName
& (Join-Path $framework 'csc.exe') /nologo /target:winexe /platform:x64 /optimize+ /utf8output ('/win32icon:' + $icon) ('/out:' + (Join-Path $projectRoot 'AfterHours.exe')) @refs @sources
if ($LASTEXITCODE -ne 0) { throw 'Native client compilation failed' }
