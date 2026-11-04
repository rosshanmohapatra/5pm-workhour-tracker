// Event handlers for index.html. They used to be inline on*="" attributes;
// the Content Security Policy forbids those now. Elements point here with
// data-on-<event>="<key>", and lib/csp-handlers.js attaches them.
// To add one: give the element data-on-click="hYourKey" and add hYourKey
// below, or attach a listener in code instead.
window.__H = Object.assign(window.__H || {}, {
  // onblur: _qsOnBlur()
  h636226bbbd: function (event) { _qsOnBlur() },
  // onchange: autoSaveSettings()
  h6e8f4ddeed: function (event) { autoSaveSettings() },
  // onchange: if(!this.checked) disableDevMode()
  h8064594bc5: function (event) { if(!this.checked) disableDevMode() },
  // onchange: obToggleIncludeSaturday(this.checked)
  h9146bd9f54: function (event) { obToggleIncludeSaturday(this.checked) },
  // onchange: onNotifToggleChange()
  hcf713bf8fc: function (event) { onNotifToggleChange() },
  // onchange: onRecommendTimingsChange(this.checked)
  h10c9abe4cc: function (event) { onRecommendTimingsChange(this.checked) },
  // onchange: onUse24hChange()
  h5c650675dd: function (event) { onUse24hChange() },
  // onchange: toggleIncludeSaturday(this.checked)
  h837d691c9b: function (event) { toggleIncludeSaturday(this.checked) },
  // onclick: (function(){ const h = el('dailyTargetHours'); if(h) h.textContent = '9h 00m'; el('dailyTa
  h84ab8695be: function (event) { (function(){ const h = el('dailyTargetHours'); if(h) h.textContent = '9h 00m'; el('dailyTargetReachedOverlay').classList.add('open'); })() },
  // onclick: (function(){ var o=document.getElementById('iosInstallOverlay'),s=document.getElementById(
  h758fa20afc: function (event) { (function(){ var o=document.getElementById('iosInstallOverlay'),s=document.getElementById('iosInstallSheet'); o.style.display='block'; s.style.display='block'; requestAnimationFrame(function(){ requestAnimationFrame(function(){ s.style.transform='translateY(0)'; }); }); })() },
  // onclick: Notification.requestPermission().then(function(p){if(p==='granted')document.getElementById
  h06a0f13802: function (event) { Notification.requestPermission().then(function(p){if(p==='granted')document.getElementById('notifPermBar').classList.remove('show')}) },
  // onclick: _asrUpdate()
  hfc7764bd8f: function (event) { _asrUpdate() },
  // onclick: _copyBackupCodes()
  hf7caab5dc9: function (event) { _copyBackupCodes() },
  // onclick: _copyDiagLog()
  haab61e2144: function (event) { _copyDiagLog() },
  // onclick: _copyMfaSecret()
  hf1b50073cd: function (event) { _copyMfaSecret() },
  // onclick: _copyUpi()
  had1af3fc7a: function (event) { _copyUpi() },
  // onclick: _dismissRunningElsewhereBanner()
  h721b8ac2df: function (event) { _dismissRunningElsewhereBanner() },
  // onclick: _downloadBackupCodes()
  h77019e8e6d: function (event) { _downloadBackupCodes() },
  // onclick: _onSyncBtnClick()
  hbaa505cd7f: function (event) { _onSyncBtnClick() },
  // onclick: _rcSwitchPair('progress',this)
  h0b009e2a27: function (event) { _rcSwitchPair('progress',this) },
  // onclick: _rcSwitchPair('times',this)
  ha2f6205fb2: function (event) { _rcSwitchPair('times',this) },
  // onclick: _reportSetMode('month')
  h08d903c236: function (event) { _reportSetMode('month') },
  // onclick: _reportSetMode('week')
  h12b61196e3: function (event) { _reportSetMode('week') },
  // onclick: _selectFuturePlanType(this.getAttribute('data-click-a0'),this.getAttribute('data-click-a1'
  hf0bed0e243: function (event) { _selectFuturePlanType(this.getAttribute('data-click-a0'),this.getAttribute('data-click-a1'),this) },
  // onclick: _submitWkndNote()
  h274a5d5671: function (event) { _submitWkndNote() },
  // onclick: _tdConfirm()
  h3d8c4a4b3a: function (event) { _tdConfirm() },
  // onclick: _tdPick('fullday')
  h6111ed02c2: function (event) { _tdPick('fullday') },
  // onclick: _tdPick('halfday')
  ha3743ad448: function (event) { _tdPick('halfday') },
  // onclick: _tdPick('holiday')
  ha06142f505: function (event) { _tdPick('holiday') },
  // onclick: _tdPick('leave')
  h1c1853eeb9: function (event) { _tdPick('leave') },
  // onclick: _tdToggle(event)
  hfba6e822e4: function (event) { _tdToggle(event) },
  // onclick: _toggleDiagLog()
  h9d50e8ba4f: function (event) { _toggleDiagLog() },
  // onclick: _toggleModalTip(this)
  h335c87590c: function (event) { _toggleModalTip(this) },
  // onclick: _tpSwitchTab('login')
  hf5998e6104: function (event) { _tpSwitchTab('login') },
  // onclick: _tpSwitchTab('logout')
  hb8a39e6460: function (event) { _tpSwitchTab('logout') },
  // onclick: _tzSelectEntry(this.getAttribute('data-click-a0'), JSON.parse(this.getAttribute('data-clic
  h2620a6c9a8: function (event) { _tzSelectEntry(this.getAttribute('data-click-a0'), JSON.parse(this.getAttribute('data-click-a1'))) },
  // onclick: _tzToggle(event)
  h7897ea40b0: function (event) { _tzToggle(event) },
  // onclick: _wpJumpToday()
  hbe08bc8238: function (event) { _wpJumpToday() },
  // onclick: _wpNextMonth()
  heec0609f00: function (event) { _wpNextMonth() },
  // onclick: _wpPrevMonth()
  h797382739c: function (event) { _wpPrevMonth() },
  // onclick: addPasskey()
  hb85c95a0ae: function (event) { addPasskey() },
  // onclick: applyShiftPreset(this.getAttribute('data-click-a0'),this.getAttribute('data-click-a1'))
  h3e4f8c7bd2: function (event) { applyShiftPreset(this.getAttribute('data-click-a0'),this.getAttribute('data-click-a1')) },
  // onclick: authVerify()
  hc38159dc96: function (event) { authVerify() },
  // onclick: backToDeleteFeedback()
  hfe373ca6db: function (event) { backToDeleteFeedback() },
  // onclick: cancelOrClearTpModal()
  h26a5552a4b: function (event) { cancelOrClearTpModal() },
  // onclick: clearDevDateOverride()
  h2ac88a213a: function (event) { clearDevDateOverride() },
  // onclick: closeAutoStopRecovery()
  h6bf3bb701d: function (event) { closeAutoStopRecovery() },
  // onclick: closeCheckoutModal()
  h450089b5c0: function (event) { closeCheckoutModal() },
  // onclick: closeCreatePwdModal()
  h4a3a5904d3: function (event) { closeCreatePwdModal() },
  // onclick: closeDeleteModal()
  h141914e708: function (event) { closeDeleteModal() },
  // onclick: closeDevicesModal()
  h91fe521014: function (event) { closeDevicesModal() },
  // onclick: closeFpModal()
  h69037e5ab4: function (event) { closeFpModal() },
  // onclick: closeImportModal()
  h218e700fa8: function (event) { closeImportModal() },
  // onclick: closeIosInstall(event)
  h75d44fd18b: function (event) { closeIosInstall(event) },
  // onclick: closeMfaModal()
  hda8b08904c: function (event) { closeMfaModal() },
  // onclick: closeNotifPanel()
  h6c1af32ae5: function (event) { closeNotifPanel() },
  // onclick: closeOutsideShiftModal()
  h777a3469ff: function (event) { closeOutsideShiftModal() },
  // onclick: closeSupportModal()
  hd99fc99687: function (event) { closeSupportModal() },
  // onclick: closeTodayDetails()
  hfbcc321d43: function (event) { closeTodayDetails() },
  // onclick: closeUpwdModal()
  h3fd8d2a73b: function (event) { closeUpwdModal() },
  // onclick: closeWeekReport()
  h106648fa62: function (event) { closeWeekReport() },
  // onclick: confirmDeleteProfile()
  hffc28330a5: function (event) { confirmDeleteProfile() },
  // onclick: confirmLogout()
  hc1fb0c2186: function (event) { confirmLogout() },
  // onclick: confirmRemovePasskey()
  h69f23197dd: function (event) { confirmRemovePasskey() },
  // onclick: confirmTpModal()
  h11d2982109: function (event) { confirmTpModal() },
  // onclick: devRevokeOthers()
  h367b412f61: function (event) { devRevokeOthers() },
  // onclick: downloadForWindows(this)
  hcc56d74386: function (event) { downloadForWindows(this) },
  // onclick: downloadWeekReport()
  hf11c074512: function (event) { downloadWeekReport() },
  // onclick: el('cancelPlanOverlay').classList.remove('open')
  h60803b94db: function (event) { el('cancelPlanOverlay').classList.remove('open') },
  // onclick: el('continueWorkingOverlay').classList.remove('open')
  h9ff643fe8d: function (event) { el('continueWorkingOverlay').classList.remove('open') },
  // onclick: el('devModeToggle').click()
  hb03e1f492f: function (event) { el('devModeToggle').click() },
  // onclick: el('endSessionOverlay').classList.remove('open')
  h77a742fb72: function (event) { el('endSessionOverlay').classList.remove('open') },
  // onclick: el('importConfirmOverlay').classList.remove('open')
  heac8a99fb5: function (event) { el('importConfirmOverlay').classList.remove('open') },
  // onclick: el('inp24h').click()
  h15fa1ca95e: function (event) { el('inp24h').click() },
  // onclick: el('inpAutostart').click()
  h4d839211ef: function (event) { el('inpAutostart').click() },
  // onclick: el('inpBreakTime').click()
  hc23e743587: function (event) { el('inpBreakTime').click() },
  // onclick: el('inpIncludeSat').click()
  h532b3fdb68: function (event) { el('inpIncludeSat').click() },
  // onclick: el('inpNotifKickstart').click()
  hb0ea15a3b9: function (event) { el('inpNotifKickstart').click() },
  // onclick: el('inpNotifOn').click()
  he511c59fdf: function (event) { el('inpNotifOn').click() },
  // onclick: el('inpNotifOvertime').click()
  h0b649091e3: function (event) { el('inpNotifOvertime').click() },
  // onclick: el('inpNotifTarget').click()
  hdb04205b37: function (event) { el('inpNotifTarget').click() },
  // onclick: el('inpRecommendTimings').click()
  hffcca0a2df: function (event) { el('inpRecommendTimings').click() },
  // onclick: el('logoutOverlay').classList.remove('open')
  h3a488fe697: function (event) { el('logoutOverlay').classList.remove('open') },
  // onclick: el('newPlanOverlay').classList.remove('open')
  h1bdb7f1b54: function (event) { el('newPlanOverlay').classList.remove('open') },
  // onclick: el('obIncludeSat').click()
  h3da55a4fae: function (event) { el('obIncludeSat').click() },
  // onclick: el('pkRemoveOverlay').classList.remove('open')
  h8a0431c316: function (event) { el('pkRemoveOverlay').classList.remove('open') },
  // onclick: el('weekPlanOverlay').classList.remove('open')
  h4d52d42341: function (event) { el('weekPlanOverlay').classList.remove('open') },
  // onclick: event.stopPropagation()
  h6d554283fa: function (event) { event.stopPropagation() },
  // onclick: event.stopPropagation();_dismissPenaltyRow(this.closest('.penalty-row'))
  h61f06aeef3: function (event) { event.stopPropagation();_dismissPenaltyRow(this.closest('.penalty-row')) },
  // onclick: event.stopPropagation();clearTodayTarget()
  h77514bfee8: function (event) { event.stopPropagation();clearTodayTarget() },
  // onclick: event.stopPropagation();openDayEditModal(this.getAttribute('data-click-a0'),true)
  h27129cfe3c: function (event) { event.stopPropagation();openDayEditModal(this.getAttribute('data-click-a0'),true) },
  // onclick: event.stopPropagation();resetQsShortcut()
  he8e64385df: function (event) { event.stopPropagation();resetQsShortcut() },
  // onclick: event.stopPropagation();startQsRecording()
  hc5fc1accce: function (event) { event.stopPropagation();startQsRecording() },
  // onclick: fpBackToEmail()
  h418322c9b7: function (event) { fpBackToEmail() },
  // onclick: fpResend()
  hb7eda186b0: function (event) { fpResend() },
  // onclick: fpSendEmail()
  hb81b94c73b: function (event) { fpSendEmail() },
  // onclick: fpVerify()
  h93f72182ed: function (event) { fpVerify() },
  // onclick: goToDeletePwd()
  hf9398af895: function (event) { goToDeletePwd() },
  // onclick: handleNotifCta(this.getAttribute('data-click-a0'),this.getAttribute('data-click-a1'))
  h837093f811: function (event) { handleNotifCta(this.getAttribute('data-click-a0'),this.getAttribute('data-click-a1')) },
  // onclick: if(event.target===this)closeAutoStopRecovery()
  haef0170aaa: function (event) { if(event.target===this)closeAutoStopRecovery() },
  // onclick: if(event.target===this)closeCreatePwdModal()
  hb860e060ea: function (event) { if(event.target===this)closeCreatePwdModal() },
  // onclick: if(event.target===this)closeDevicesModal()
  h48cd7bfcf4: function (event) { if(event.target===this)closeDevicesModal() },
  // onclick: if(event.target===this)closeImportModal()
  h36d7cea20b: function (event) { if(event.target===this)closeImportModal() },
  // onclick: if(event.target===this)closeMfaModal()
  h113e0028ba: function (event) { if(event.target===this)closeMfaModal() },
  // onclick: if(event.target===this)closeSupportModal()
  h033ffc86cc: function (event) { if(event.target===this)closeSupportModal() },
  // onclick: if(event.target===this)closeUpwdModal()
  h297f2f79df: function (event) { if(event.target===this)closeUpwdModal() },
  // onclick: if(event.target===this)closeWeekReport()
  hcfff7eb09d: function (event) { if(event.target===this)closeWeekReport() },
  // onclick: if(event.target===this)el('continueWorkingOverlay').classList.remove('open')
  hc056d60086: function (event) { if(event.target===this)el('continueWorkingOverlay').classList.remove('open') },
  // onclick: mfaConfirmDisable()
  ha5880d0f8f: function (event) { mfaConfirmDisable() },
  // onclick: mfaShowDisable()
  h0d46da7c63: function (event) { mfaShowDisable() },
  // onclick: mfaShowManage()
  hfa2eb79cc6: function (event) { mfaShowManage() },
  // onclick: mfaShowSuccess()
  h3f17ee1b27: function (event) { mfaShowSuccess() },
  // onclick: mfaVerifyEnroll()
  ha18a9a252c: function (event) { mfaVerifyEnroll() },
  // onclick: navDaySelectorDay(-1)
  h776b844886: function (event) { navDaySelectorDay(-1) },
  // onclick: navDaySelectorDay(1)
  hde52b3e389: function (event) { navDaySelectorDay(1) },
  // onclick: navigator.clipboard?.writeText(this.dataset.uid||'');showToast('User ID copied','info','',
  h3082bc57c8: function (event) { navigator.clipboard?.writeText(this.dataset.uid||'');showToast('User ID copied','info','',{label:'Okay'}) },
  // onclick: npSetType('allday')
  h84f8bee52e: function (event) { npSetType('allday') },
  // onclick: npSetType('early')
  h4b05cc8e2d: function (event) { npSetType('early') },
  // onclick: npSetType('half')
  hf5b8683dda: function (event) { npSetType('half') },
  // onclick: npSetType('late')
  h2676943c4a: function (event) { npSetType('late') },
  // onclick: obSkip()
  h33bd4b028a: function (event) { obSkip() },
  // onclick: obStep(-1)
  h12e82dc530: function (event) { obStep(-1) },
  // onclick: obStep(1)
  h7e2e5de73d: function (event) { obStep(1) },
  // onclick: obSwitchTab('daily')
  hb6b5e5ec42: function (event) { obSwitchTab('daily') },
  // onclick: obSwitchTab('weekly')
  h560bb462a2: function (event) { obSwitchTab('weekly') },
  // onclick: openAnalyticsWeekPicker(this)
  hcc29c6d1fd: function (event) { openAnalyticsWeekPicker(this) },
  // onclick: openAuthView()
  h670fc5e48d: function (event) { openAuthView() },
  // onclick: openAutoStopRecovery()
  he05a50dca0: function (event) { openAutoStopRecovery() },
  // onclick: openContinueWorkingModal('09:00 AM', 3 * 3600)
  h386fbeb337: function (event) { openContinueWorkingModal('09:00 AM', 3 * 3600) },
  // onclick: openDailyTargetPicker(event)
  hd664c7b280: function (event) { openDailyTargetPicker(event) },
  // onclick: openDayEditModal(selectedDayKey)
  hf5017a9390: function (event) { openDayEditModal(selectedDayKey) },
  // onclick: openDayEditModal(this.getAttribute('data-click-a0'))
  hd2a73229c7: function (event) { openDayEditModal(this.getAttribute('data-click-a0')) },
  // onclick: openDeleteModal()
  ha5a8dbb3e6: function (event) { openDeleteModal() },
  // onclick: openDevDatePicker(this)
  h26e082bc21: function (event) { openDevDatePicker(this) },
  // onclick: openDevicesModal()
  hc41b20f447: function (event) { openDevicesModal() },
  // onclick: openEmailModal(this.getAttribute('data-click-a0'))
  h76411799e3: function (event) { openEmailModal(this.getAttribute('data-click-a0')) },
  // onclick: openImportModal()
  h52e490390c: function (event) { openImportModal() },
  // onclick: openLoginLogoutPicker(event)
  hcf7f64465c: function (event) { openLoginLogoutPicker(event) },
  // onclick: openLogoutModal()
  ha5895024d2: function (event) { openLogoutModal() },
  // onclick: openOnboarding()
  h028997d4ce: function (event) { openOnboarding() },
  // onclick: openPrivacyPolicy()
  h526061ddf1: function (event) { openPrivacyPolicy() },
  // onclick: openSupportModal()
  ha851ef3e6b: function (event) { openSupportModal() },
  // onclick: openTpModal('asrEndTime',event,'End Time',_asrOnTimeChange)
  h16a0fbc574: function (event) { openTpModal('asrEndTime',event,'End Time',_asrOnTimeChange) },
  // onclick: openTpModal('deEnd',event,'Logout')
  hf33bddd233: function (event) { openTpModal('deEnd',event,'Logout') },
  // onclick: openTpModal('deStart',event,'Login')
  h793544eada: function (event) { openTpModal('deStart',event,'Login') },
  // onclick: openTpModal('inpShiftEnd',event)
  h630bcad8de: function (event) { openTpModal('inpShiftEnd',event) },
  // onclick: openTpModal('inpShiftStart',event)
  h9b8ff4420c: function (event) { openTpModal('inpShiftStart',event) },
  // onclick: openTpModal('obShiftEnd',event)
  h2938640370: function (event) { openTpModal('obShiftEnd',event) },
  // onclick: openTpModal('obShiftStart',event)
  h745e056836: function (event) { openTpModal('obShiftStart',event) },
  // onclick: openTpModal('tc-r7m2',event,'Log In',calculate)
  h835997ffb5: function (event) { openTpModal('tc-r7m2',event,'Log In',calculate) },
  // onclick: openWeekPicker(this)
  h9f54862d09: function (event) { openWeekPicker(this) },
  // onclick: openWeekReport()
  ha2992aba2f: function (event) { openWeekReport() },
  // onclick: openWeekReport(analyticsWeekOffset)
  ha2e8e1871e: function (event) { openWeekReport(analyticsWeekOffset) },
  // onclick: overrideOutsideShift()
  hf6ae0386e2: function (event) { overrideOutsideShift() },
  // onclick: runSyncDiagnostic()
  h9dee7dcd2e: function (event) { runSyncDiagnostic() },
  // onclick: setAppTheme('auto', this)
  ha1e6c02f2c: function (event) { setAppTheme('auto', this) },
  // onclick: setAppTheme('dark', this)
  h70155e2dab: function (event) { setAppTheme('dark', this) },
  // onclick: setAppTheme('light', this)
  hbaac90494f: function (event) { setAppTheme('light', this) },
  // onclick: setDeOverride('halfday')
  h78736406eb: function (event) { setDeOverride('halfday') },
  // onclick: setDeOverride('holiday')
  hafbff54015: function (event) { setDeOverride('holiday') },
  // onclick: setDeOverride('leave')
  h1bbffb6125: function (event) { setDeOverride('leave') },
  // onclick: showCheckoutModal('09:00 AM', new Date(), 9 * 3600)
  h52a198b696: function (event) { showCheckoutModal('09:00 AM', new Date(), 9 * 3600) },
  // onclick: showOutsideShiftModal(null)
  hc75064a50f: function (event) { showOutsideShiftModal(null) },
  // onclick: startQsRecording()
  h790dc79236: function (event) { startQsRecording() },
  // onclick: submitCreatePwd()
  h9b33e57995: function (event) { submitCreatePwd() },
  // onclick: switchStTab('daily')
  h9cddcb4c4f: function (event) { switchStTab('daily') },
  // onclick: switchStTab('weekly')
  he6baa01278: function (event) { switchStTab('weekly') },
  // onclick: testNotif('earlyLeave')
  h796df97bfe: function (event) { testNotif('earlyLeave') },
  // onclick: testNotif('forgotStop')
  h8844d24a9f: function (event) { testNotif('forgotStop') },
  // onclick: testNotif('morningReminder')
  h0e09a8700e: function (event) { testNotif('morningReminder') },
  // onclick: testNotif('overtime')
  hd0aee76806: function (event) { testNotif('overtime') },
  // onclick: testNotif('target')
  hbd597048b4: function (event) { testNotif('target') },
  // onclick: toggleDelChip(this)
  hcfbcfd2223: function (event) { toggleDelChip(this) },
  // onclick: toggleDeletePwd()
  hd74ced6fb2: function (event) { toggleDeletePwd() },
  // onclick: upwdSendResetLink()
  h52d1f344ac: function (event) { upwdSendResetLink() },
  // onclick: window.location.replace(location.pathname)
  h248485a70e: function (event) { window.location.replace(location.pathname) },
  // oninput: _wkndNoteAutoGrow(this)
  h8da34fa172: function (event) { _wkndNoteAutoGrow(this) },
  // oninput: autoExpandTa(this)
  h1e8a7114e5: function (event) { autoExpandTa(this) },
  // oninput: el('delPwdContinueBtn').disabled = this.value.length < 1
  hf2ee0f7d5a: function (event) { el('delPwdContinueBtn').disabled = this.value.length < 1 },
  // oninput: el('fpVerifyBtn').disabled=this.value.length<6||fpExpired
  h48bff94753: function (event) { el('fpVerifyBtn').disabled=this.value.length<6||fpExpired },
  // oninput: saveFutureDayReason(this.value)
  hc55a156350: function (event) { saveFutureDayReason(this.value) },
  // oninput: this.value=this.value.replace(/\D/g,'').slice(0,6);el('mfaVerifyBtn').disabled=this.value.
  hd4f1fc3f54: function (event) { this.value=this.value.replace(/\D/g,'').slice(0,6);el('mfaVerifyBtn').disabled=this.value.length<6 },
  // oninput: updateObWeeklyCalc()
  ha4dcc2a851: function (event) { updateObWeeklyCalc() },
  // oninput: updateWeeklyCalc()
  h13c3dda947: function (event) { updateWeeklyCalc() },
  // onkeydown: _wkndNoteKey(event,this)
  h17e620946f: function (event) { _wkndNoteKey(event,this) },
  // onload: this.media='all'
  he403411552: function (event) { this.media='all' },
  // onmouseenter: _showModalTip(this)
  h2bb7e7eb46: function (event) { _showModalTip(this) },
  // onmouseleave: _hideModalTip()
  h83efb5e4ca: function (event) { _hideModalTip() },
  // onmouseout: this.style.opacity=.8
  hd75e357a3a: function (event) { this.style.opacity=.8 },
  // onmouseout: this.style.textDecoration='none'
  h9ca1463baf: function (event) { this.style.textDecoration='none' },
  // onmouseover: this.style.opacity=1
  h14373a3cf1: function (event) { this.style.opacity=1 },
  // onmouseover: this.style.textDecoration='underline'
  h745d1ed038: function (event) { this.style.textDecoration='underline' },
});
