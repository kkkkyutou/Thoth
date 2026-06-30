if [[ -n "${_THOTH_ZSH_INTEGRATION_LOADED-}" ]]; then
  return
fi
typeset -g _THOTH_ZSH_INTEGRATION_LOADED=1

autoload -Uz add-zsh-hook

typeset -g _THOTH_ZSH_COMMAND_ACTIVE=0

function _thoth_osc633() {
  printf '\e]633;%s\a' "$1"
}

function _thoth_precmd() {
  local command_status=$?
  if [[ "$_THOTH_ZSH_COMMAND_ACTIVE" == "1" ]]; then
    _thoth_osc633 "D;${command_status}"
    _THOTH_ZSH_COMMAND_ACTIVE=0
  fi
  printf '\e]2;%s\a' "${PWD/#$HOME/~}"
  _thoth_osc633 "A"
}

function _thoth_preexec() {
  _THOTH_ZSH_COMMAND_ACTIVE=1
  _thoth_osc633 "B"
  _thoth_osc633 "C"
  printf '\e]2;%s\a' "$1"
}

add-zsh-hook precmd _thoth_precmd
add-zsh-hook preexec _thoth_preexec
