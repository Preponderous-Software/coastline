@echo off
setlocal EnableDelayedExpansion
rem Plays Coastline (the fractal coastline game on the Strata engine) in its own
rem app window, like the other games on this desktop. It copies the current files
rem from the folder in WSL (or runs the last copy if WSL is not available), serves
rem them on this PC only, and stops the server when the game window closes.
rem Progress is saved in the game's own window profile and continues where you
rem left off.
rem Extra arguments, e.g.:
rem   play-coastline.bat --new        start over (the old progress is kept as the previous save)
rem   play-coastline.bat --economy    smaller, cheaper 3D render for slow graphics
rem   play-coastline.bat --browser    open in your normal browser instead of an app window

set "CO_DIR=%USERPROFILE%\coastline-play"
set "CO_SRC=\\wsl$\Ubuntu\root\coastline"
set "CO_PROFILE=%LOCALAPPDATA%\Coastline\window"
if not defined CO_PORT set "CO_PORT=8784"
set "QUERY="
set "BROWSER="
for %%a in (%*) do (
    if /i "%%~a"=="economy"   set "QUERY=!QUERY!&economy=1"
    if /i "%%~a"=="--economy" set "QUERY=!QUERY!&economy=1"
    if /i "%%~a"=="new"       set "QUERY=!QUERY!&new=1"
    if /i "%%~a"=="--new"     set "QUERY=!QUERY!&new=1"
    if /i "%%~a"=="--browser" set "BROWSER=1"
)
if defined QUERY set "QUERY=?!QUERY:~1!"
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

rem The app window: Microsoft Edge in app mode (no tabs or address bar, its own
rem taskbar entry and its own profile, so the save stays put). Falls back to the
rem normal browser if Edge is missing or --browser was given.
set "EDGE="
for %%e in ("%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe") do (
    if not defined EDGE if exist "%%~e" set "EDGE=%%~e"
)
if defined BROWSER set "EDGE="

rem Start the server unless one is already running (the files above are fresh and
rem the server never caches, so a running one serves the new copy).
set "STARTED="
curl.exe -s -o NUL "http://127.0.0.1:%CO_PORT%/index.html"
if errorlevel 1 (
    start "Coastline server" /min py -3 "%CO_DIR%\tools\serve.py" "%CO_DIR%\web" %CO_PORT%
    set "STARTED=1"
    for /l %%i in (1,1,40) do (
        curl.exe -s -o NUL "http://127.0.0.1:%CO_PORT%/index.html" && goto :ready
        ping -n 1 -w 250 127.0.0.1 >nul
    )
    echo The game server did not start. & pause & exit /b 1
)
:ready

if defined CO_DRYRUN (
    echo DRYRUN url=!URL!
    if defined EDGE (echo DRYRUN app="!EDGE!" "--app=!URL!" --user-data-dir="!CO_PROFILE!") else (echo DRYRUN browser=!URL!)
    goto :stop
)

if not defined EDGE (
    start "" "!URL!"
    echo Coastline is open in your browser. Close this window to stop the game's server.
    pause >nul
    goto :stop
)

rem Wait for the game window to close (its own profile makes it a separate
rem process), then stop the server this script started.
start "" /wait "!EDGE!" "--app=!URL!" --user-data-dir="!CO_PROFILE!" --window-size=1280,800 --no-first-run --no-default-browser-check --disable-features=Translate

:stop
if defined STARTED taskkill /fi "WINDOWTITLE eq Coastline server*" /t /f >nul 2>nul
exit /b 0
