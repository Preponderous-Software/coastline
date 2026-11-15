@echo off
setlocal
rem Opens Coastline, the fractal coastline game, in your browser (this PC only).
rem No GitHub or sign-in: it copies the current files from the folder in WSL, or runs the
rem last copy if WSL is not available. Close this window to stop the game's server.
rem Options:
rem   play-coastline.bat economy    smaller, cheaper 3D render for slow graphics

set "CO_DIR=%USERPROFILE%\coastline-play"
set "CO_SRC=\\wsl$\Ubuntu\root\coastline"
if not defined CO_PORT set "CO_PORT=8784"
set "QUERY="
for %%a in (%*) do (
    if /i "%%~a"=="economy" set "QUERY=?economy=1"
)
set "URL=http://127.0.0.1:%CO_PORT%/%QUERY%"

where py >nul 2>nul || (
    echo Coastline needs Python 3 to serve its files. Installing it with winget ...
    winget install --id Python.Python.3.13 -e --accept-source-agreements --accept-package-agreements || (echo Install it from https://www.python.org/downloads/ & pause & exit /b 1)
    echo Python installed. Close this window and run the script again.
    pause
    exit /b 0
)

if exist "%CO_SRC%\web\index.html" (
    echo Copying the latest files from WSL ...
    robocopy "%CO_SRC%" "%CO_DIR%" /MIR /XD .git node_modules shots /NFL /NDL /NJH /NJS /NP >nul
    if errorlevel 8 (echo Copying failed. & pause & exit /b 1)
) else (
    echo WSL is not available, using the last copy.
)
if not exist "%CO_DIR%\web\index.html" (echo No copy of Coastline yet. Start WSL and run this again. & pause & exit /b 1)

rem Already running? The files above are fresh and the server never caches, so just open the browser.
curl.exe -s -o NUL "http://127.0.0.1:%CO_PORT%/index.html" && (start "" "%URL%" & exit /b 0)

title Coastline
if defined CO_NO_BROWSER (
    py -3 "%CO_DIR%\tools\serve.py" "%CO_DIR%\web" %CO_PORT%
) else (
    py -3 "%CO_DIR%\tools\serve.py" "%CO_DIR%\web" %CO_PORT% --open "%URL%"
)
if errorlevel 1 pause
