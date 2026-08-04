@rem
@rem Windows Gradle wrapper
@rem
@echo off
setlocal

set DIRNAME=%~dp0
if "%DIRNAME%" == "" set DIRNAME=.
set APP_BASE_NAME=%~n0
set APP_HOME=%DIRNAME%

set CLASSPATH=%APP_HOME%\gradle\wrapper\gradle-wrapper.jar

for /f "usebackq" %%i in (`"%ProgramFiles%\Java\jdk*\bin\java.exe" -version 2^>^&1 ^| findstr /i "version"`) do (
    set JAVA_EXE="%ProgramFiles%\Java\jdk*\bin\java.exe"
)
if "%JAVA_EXE%"=="" set JAVA_EXE=java

%JAVA_EXE% -classpath "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %*
