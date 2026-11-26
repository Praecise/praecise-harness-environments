@echo off
rem Build the Windows helper with the compiler that is part of Windows. Nothing is installed.
rem
rem   build.cmd [output]        default: praecise-computer-helper.exe beside this file
setlocal
set FW=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319
set OUT=%~1
if "%OUT%"=="" set OUT=%~dp0praecise-computer-helper.exe
"%FW%\csc.exe" /nologo /optimize+ /platform:x64 /target:exe /out:"%OUT%" /lib:"%FW%\WPF" /r:UIAutomationClient.dll /r:UIAutomationTypes.dll /r:WindowsBase.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll "%~dp0Helper.cs"
exit /b %ERRORLEVEL%
