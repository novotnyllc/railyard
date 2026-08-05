#!/usr/bin/env bash

ORACLE_FORMULA="steipete/tap/oracle"
ORACLE_MINIMUM_VERSION="0.17.0"
ORACLE_NPM_PACKAGE="@steipete/oracle"

oracle_error() {
  printf '%s\n' "$*" >&2
}

oracle_version_from_output() {
  if [[ "$1" =~ ([0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?) ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi

  return 1
}

oracle_highest_version_from_output() {
  local oracle_output="$1"
  local oracle_match oracle_version oracle_highest_version

  while [[ "$oracle_output" =~ ([0-9]+)\.([0-9]+)\.([0-9]+) ]]; do
    oracle_match="${BASH_REMATCH[0]}"
    oracle_version="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.${BASH_REMATCH[3]}"
    if [ -z "$oracle_highest_version" ] || oracle_version_at_least "$oracle_version" "$oracle_highest_version"; then
      oracle_highest_version="$oracle_version"
    fi
    oracle_output="${oracle_output#*"$oracle_match"}"
  done

  if [ -z "$oracle_highest_version" ]; then
    return 1
  fi

  printf '%s\n' "$oracle_highest_version"
}

oracle_version_at_least() {
  local oracle_version="$1"
  local oracle_minimum="$2"
  local oracle_major oracle_minor oracle_patch
  local oracle_minimum_major oracle_minimum_minor oracle_minimum_patch

  if [[ ! "$oracle_version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    return 1
  fi
  oracle_major=$((10#${BASH_REMATCH[1]}))
  oracle_minor=$((10#${BASH_REMATCH[2]}))
  oracle_patch=$((10#${BASH_REMATCH[3]}))

  if [[ ! "$oracle_minimum" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    return 1
  fi
  oracle_minimum_major=$((10#${BASH_REMATCH[1]}))
  oracle_minimum_minor=$((10#${BASH_REMATCH[2]}))
  oracle_minimum_patch=$((10#${BASH_REMATCH[3]}))

  if [ "$oracle_major" -ne "$oracle_minimum_major" ]; then
    [ "$oracle_major" -gt "$oracle_minimum_major" ]
    return
  fi
  if [ "$oracle_minor" -ne "$oracle_minimum_minor" ]; then
    [ "$oracle_minor" -gt "$oracle_minimum_minor" ]
    return
  fi

  [ "$oracle_patch" -ge "$oracle_minimum_patch" ]
}

oracle_executable_version() {
  local oracle_path="$1"
  local oracle_version_output oracle_version

  oracle_version_output=$("$oracle_path" --version 2>&1)
  if [ $? -ne 0 ]; then
    return 1
  fi

  oracle_version=$(oracle_version_from_output "$oracle_version_output")
  if [ $? -ne 0 ]; then
    return 1
  fi

  printf '%s\n' "$oracle_version"
}

oracle_validate_executable() {
  local oracle_path="$1"
  local oracle_source="$2"
  local oracle_version

  case "$oracle_path" in
    /*) ;;
    *)
      oracle_error "$oracle_source must be an absolute executable path."
      return 1
      ;;
  esac

  if [ ! -f "$oracle_path" ] || [ ! -x "$oracle_path" ]; then
    oracle_error "$oracle_source is not an executable regular file: $oracle_path"
    return 1
  fi

  oracle_version=$(oracle_executable_version "$oracle_path")
  if [ $? -ne 0 ]; then
    oracle_error "$oracle_source failed to report a numeric version: $oracle_path"
    return 1
  fi

  if ! oracle_version_at_least "$oracle_version" "$ORACLE_MINIMUM_VERSION"; then
    oracle_error "$oracle_source is too old ($oracle_version; need $ORACLE_MINIMUM_VERSION or newer): $oracle_path"
    return 1
  fi

  printf '%s\n' "$oracle_path"
}

oracle_find_brew() {
  local oracle_brew

  for oracle_brew in /opt/homebrew/bin/brew /usr/local/bin/brew /home/linuxbrew/.linuxbrew/bin/brew; do
    if [ -f "$oracle_brew" ] && [ -x "$oracle_brew" ]; then
      printf '%s\n' "$oracle_brew"
      return 0
    fi
  done

  return 1
}

oracle_find_npm() {
  local oracle_npm

  oracle_npm=$(command -v npm 2>/dev/null) || return 1
  case "$oracle_npm" in
    /*) ;;
    *) return 1 ;;
  esac
  if [ ! -f "$oracle_npm" ] || [ ! -x "$oracle_npm" ]; then
    return 1
  fi

  printf '%s\n' "$oracle_npm"
}

oracle_current_npm_executable() {
  local oracle_executable oracle_version

  case "${HOME:-}" in
    /*) ;;
    *) return 1 ;;
  esac

  oracle_executable="$HOME/.local/bin/oracle"
  oracle_version=$(oracle_executable_version "$oracle_executable")
  if [ $? -eq 0 ] && oracle_version_at_least "$oracle_version" "$ORACLE_MINIMUM_VERSION"; then
    printf '%s\n' "$oracle_executable"
    return 0
  fi

  return 1
}

oracle_ensure_npm() {
  local oracle_reason="$1"
  local oracle_npm_prefix oracle_executable oracle_npm

  case "${HOME:-}" in
    /*) ;;
    *)
      oracle_error "$oracle_reason; HOME must be an absolute path to use the stable npm prefix."
      return 1
      ;;
  esac

  oracle_npm_prefix="$HOME/.local"
  oracle_executable=$(oracle_current_npm_executable)
  if [ $? -eq 0 ]; then
    printf '%s\n' "$oracle_executable"
    return 0
  fi

  oracle_executable="$oracle_npm_prefix/bin/oracle"

  oracle_npm=$(oracle_find_npm)
  if [ $? -ne 0 ]; then
    oracle_error "$oracle_reason; npm is unavailable to install $ORACLE_NPM_PACKAGE at $oracle_npm_prefix."
    return 1
  fi

  if ! "$oracle_npm" install --global --prefix "$oracle_npm_prefix" "$ORACLE_NPM_PACKAGE@$ORACLE_MINIMUM_VERSION" >&2; then
    oracle_error "npm could not install $ORACLE_NPM_PACKAGE@$ORACLE_MINIMUM_VERSION at $oracle_npm_prefix."
    return 1
  fi

  oracle_validate_executable "$oracle_executable" "npm package $ORACLE_NPM_PACKAGE"
}

ensure_oracle() {
  local oracle_brew oracle_listing oracle_list_code oracle_installed_version
  local oracle_prefix oracle_prefix_code oracle_executable

  if [ "${ORACLE_BIN+x}" = x ]; then
    oracle_validate_executable "$ORACLE_BIN" "ORACLE_BIN"
    return $?
  fi

  oracle_brew=$(oracle_find_brew)
  if [ $? -ne 0 ]; then
    oracle_ensure_npm "Homebrew is unavailable at /opt/homebrew/bin/brew, /usr/local/bin/brew, and /home/linuxbrew/.linuxbrew/bin/brew"
    return $?
  fi

  oracle_listing=$("$oracle_brew" list --versions --formula "$ORACLE_FORMULA" 2>&1)
  oracle_list_code=$?
  if [ "$oracle_list_code" -eq 0 ]; then
    oracle_installed_version=$(oracle_highest_version_from_output "$oracle_listing")
    if [ $? -ne 0 ]; then
      oracle_error "Homebrew did not report a numeric installed version for $ORACLE_FORMULA."
      return 1
    fi

    if ! oracle_version_at_least "$oracle_installed_version" "$ORACLE_MINIMUM_VERSION"; then
      oracle_executable=$(oracle_current_npm_executable)
      if [ $? -eq 0 ]; then
        printf '%s\n' "$oracle_executable"
        return 0
      fi
      if ! env HOMEBREW_NO_INSTALL_CLEANUP=1 HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1 "$oracle_brew" upgrade --formula --minimum-version "$ORACLE_MINIMUM_VERSION" --no-ask "$ORACLE_FORMULA" >&2; then
        oracle_ensure_npm "Homebrew could not upgrade $ORACLE_FORMULA to $ORACLE_MINIMUM_VERSION or newer"
        return $?
      fi
    fi
  elif [ "$oracle_list_code" -eq 1 ] && [ -z "$oracle_listing" ]; then
    oracle_executable=$(oracle_current_npm_executable)
    if [ $? -eq 0 ]; then
      printf '%s\n' "$oracle_executable"
      return 0
    fi
    if ! env HOMEBREW_NO_INSTALL_CLEANUP=1 HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1 "$oracle_brew" install --formula --no-ask "$ORACLE_FORMULA" >&2; then
      oracle_ensure_npm "Homebrew could not install $ORACLE_FORMULA"
      return $?
    fi
  else
    oracle_ensure_npm "Homebrew could not inspect $ORACLE_FORMULA: $oracle_listing"
    return $?
  fi

  oracle_prefix=$("$oracle_brew" --prefix "$ORACLE_FORMULA" 2>&1)
  oracle_prefix_code=$?
  if [ "$oracle_prefix_code" -ne 0 ]; then
    oracle_ensure_npm "Homebrew could not locate $ORACLE_FORMULA after verification: $oracle_prefix"
    return $?
  fi
  case "$oracle_prefix" in
    /*) ;;
    *)
      oracle_ensure_npm "Homebrew returned an invalid formula prefix for $ORACLE_FORMULA: $oracle_prefix"
      return $?
      ;;
  esac

  oracle_executable="$oracle_prefix/bin/oracle"
  if oracle_validate_executable "$oracle_executable" "Homebrew formula $ORACLE_FORMULA"; then
    return 0
  fi

  oracle_ensure_npm "Homebrew formula $ORACLE_FORMULA failed post-validation"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  ensure_oracle "$@"
fi
