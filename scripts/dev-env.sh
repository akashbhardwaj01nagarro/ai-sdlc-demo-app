# Puts a user-local .NET SDK (installed with dotnet-install into ~/.dotnet) ahead of a
# machine-wide dotnet that has no SDK. Use it from Git Bash:  source scripts/dev-env.sh
# Does nothing on machines without ~/.dotnet (CI, machines with a system SDK).
dev_env_dotnet_home="$HOME/.dotnet"
if [ -x "$dev_env_dotnet_home/dotnet.exe" ] || [ -x "$dev_env_dotnet_home/dotnet" ]; then
  case ":$PATH:" in
    *":$dev_env_dotnet_home:"*) ;;
    *) export PATH="$dev_env_dotnet_home:$dev_env_dotnet_home/tools:$PATH" ;;
  esac
  if command -v cygpath >/dev/null 2>&1; then
    DOTNET_ROOT="$(cygpath -w "$dev_env_dotnet_home")"
  else
    DOTNET_ROOT="$dev_env_dotnet_home"
  fi
  export DOTNET_ROOT
fi
export DOTNET_NOLOGO=1
export DOTNET_CLI_TELEMETRY_OPTOUT=1
unset dev_env_dotnet_home
