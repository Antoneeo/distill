@echo off
setlocal enabledelayedexpansion

:: Controllo parametri
if "%~2"=="" (
    echo Uso: git-push-tag.bat "messaggio commit" tag
    echo Esempio: git-push-tag.bat "Fix login bug" v1.2.3
    exit /b 1
)

set "COMMIT_MSG=%~1"
set "TAG=%~2"

:: Aggiungi tutti i file modificati
git add .

:: Commit con messaggio
git commit -m "%COMMIT_MSG%"

:: Crea il tag
git tag %TAG%

:: Determina branch corrente
git branch --show-current > temp_branch.txt
set /p BRANCH=<temp_branch.txt
del temp_branch.txt

:: Esegui push del commit e del tag
git push origin %BRANCH%
git push origin %TAG%
