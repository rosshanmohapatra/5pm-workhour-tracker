// Event handlers for login.html. They used to be inline on*="" attributes;
// the Content Security Policy forbids those now. Elements point here with
// data-on-<event>="<key>", and lib/csp-handlers.js attaches them.
// To add one: give the element data-on-click="hYourKey" and add hYourKey
// below, or attach a listener in code instead.
window.__H = Object.assign(window.__H || {}, {
  // onclick: backToLogin()
  heb9206632a: function (event) { backToLogin() },
  // onclick: completeRecovery()
  h0e44d80fe8: function (event) { completeRecovery() },
  // onclick: handleSubmit()
  h46df00ab5d: function (event) { handleSubmit() },
  // onclick: resendCode()
  h66fb21f3af: function (event) { resendCode() },
  // onclick: showAuthDigits()
  hd08a616183: function (event) { showAuthDigits() },
  // onclick: showRecovery()
  h360e8a7cde: function (event) { showRecovery() },
  // onclick: startEmailRecovery()
  h70c437f62a: function (event) { startEmailRecovery() },
  // onclick: toggleMode()
  hcd9818de84: function (event) { toggleMode() },
  // onclick: togglePwd()
  h59c6fde884: function (event) { togglePwd() },
  // onclick: toggleTheme()
  h6da8d21fcf: function (event) { toggleTheme() },
  // onclick: verifyBackupCode()
  h60a7d6a144: function (event) { verifyBackupCode() },
  // oninput: document.getElementById('authBackupVerify').disabled=this.value.replace(/[^a-z0-9]/gi,'').
  h6394b9e004: function (event) { document.getElementById('authBackupVerify').disabled=this.value.replace(/[^a-z0-9]/gi,'').length<8 },
  // oninput: document.getElementById('verifyOTPBtn').disabled=this.value.length<6||recExpired
  hf56c91254e: function (event) { document.getElementById('verifyOTPBtn').disabled=this.value.length<6||recExpired },
  // onload: this.media='all'
  he403411552: function (event) { this.media='all' },
});
