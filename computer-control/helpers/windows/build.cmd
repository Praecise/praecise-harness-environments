@echo off
rem Build Praecise Control for Windows with the compiler that is part of Windows. Nothing is installed.
rem
rem   build.cmd [folder]        default: the folder this file is in
rem
rem Two programs from the one file: praecise-control.exe, the app in the corner of the
rem taskbar, and praecise-computer-helper.exe, which a harness starts.
setlocal
set FW=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319
set OUT=%~1
if "%OUT%"=="" set OUT=%~dp0
set REFS=/lib:"%FW%\WPF" /r:UIAutomationClient.dll /r:UIAutomationTypes.dll /r:WindowsBase.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll
"%FW%\csc.exe" /nologo /optimize+ /platform:x64 /target:exe /out:"%OUT%\praecise-computer-helper.exe" %REFS% "%~dp0Helper.cs" || exit /b 1
"%FW%\csc.exe" /nologo /optimize+ /platform:x64 /target:winexe /define:TRAY /win32icon:"%~dp0..\..\assets\praecise-control.ico" /out:"%OUT%\praecise-control.exe" %REFS% "%~dp0Helper.cs" || exit /b 1
exit /b 0
