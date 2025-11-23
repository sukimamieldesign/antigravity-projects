@echo off
setlocal

:: ユーザー指定のパス
set "CONDA_ROOT=C:\Users\%USERNAME%\miniconda3"
set "ACTIVATE_SCRIPT=%CONDA_ROOT%\Scripts\activate.bat"

echo Checking for Miniconda at %CONDA_ROOT%...

if exist "%ACTIVATE_SCRIPT%" (
    echo Found activate script.
    goto :FOUND
) else (
    echo.
    echo [ERROR] activate.bat not found at expected location.
    echo Tried: %ACTIVATE_SCRIPT%
    echo.
    echo Trying direct python execution...
    if exist "%CONDA_ROOT%\python.exe" (
        set "PYTHON_EXE=%CONDA_ROOT%\python.exe"
        goto :DIRECT
    )
    
    REM MinicondaがLocalにある場合も考慮
    set "CONDA_ROOT_LOCAL=C:\Users\%USERNAME%\AppData\Local\miniconda3"
    if exist "%CONDA_ROOT_LOCAL%\Scripts\activate.bat" (
        set "ACTIVATE_SCRIPT=%CONDA_ROOT_LOCAL%\Scripts\activate.bat"
        goto :FOUND
    )

    echo [ERROR] Python environment not found.
    pause
    exit /b
)

:FOUND
echo Activating base environment...
call "%ACTIVATE_SCRIPT%"
goto :RUN

:DIRECT
echo Using python.exe directly...
set "PYTHON_CMD=%PYTHON_EXE%"
goto :INSTALL_AND_RUN

:RUN
set "PYTHON_CMD=python"

:INSTALL_AND_RUN
echo.
echo Installing requirements...
"%PYTHON_CMD%" -m pip install customtkinter google-generativeai pywin32 pillow pyautogui python-dotenv > nul 2>&1

echo.
echo Starting IT Priest Bot...
"%PYTHON_CMD%" main.py

endlocal
