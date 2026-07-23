@echo off
setlocal

set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" (
  echo Visual Studio 2022 C++ build tools were not found.
  exit /b 1
)

call "%VCVARS%" >nul
set "BUILD=%TEMP%\qqnt-toolbox-native"
if not exist "%BUILD%" mkdir "%BUILD%"
cl /nologo /std:c++20 /O2 /GL /MT /EHsc- /GR- /DNDEBUG /LD "%~dp0poke-bridge.cpp" /Fo"%BUILD%\poke-bridge.obj" /link user32.lib /LTCG /OPT:REF /OPT:ICF /INCREMENTAL:NO /IMPLIB:"%BUILD%\poke-bridge.lib" /PDB:"%BUILD%\poke-bridge.pdb" /OUT:"%~dp0poke-bridge.win32-x64.node"
exit /b %errorlevel%
