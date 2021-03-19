const DDGAutofill = require('./DDGAutofill')
const {
    isApp,
    notifyWebApp,
    isDDGApp,
    isAndroid,
    isDDGDomain,
    sendAndWaitForAnswer,
    setValue
} = require('./autofill-utils')
const scanForInputs = require('./scanForInputs.js')

const SIGN_IN_MSG = { signMeIn: true }

const createAttachTooltip = (getAlias, refreshAlias) => (form, input) => {
    if (isDDGApp && !isApp) {
        form.activeInput = input
        getAlias().then((alias) => {
            if (alias) form.autofill(alias)
            else form.activeInput.focus()
        })
    } else {
        if (form.tooltip) return

        form.tooltip = new DDGAutofill(input, form, getAlias, refreshAlias)
        form.intObs.observe(input)
        window.addEventListener('mousedown', form.removeTooltip, {capture: true})
    }
}

class ExtensionInterface {
    constructor () {
        this.getAlias = () => new Promise(resolve => chrome.runtime.sendMessage(
            {getAlias: true},
            ({alias}) => resolve(alias)
        ))

        this.refreshAlias = () => chrome.runtime.sendMessage({refreshAlias: true})

        this.isDeviceSignedIn = () => this.getAlias()

        this.trySigningIn = () => {
            if (isDDGDomain()) {
                sendAndWaitForAnswer(SIGN_IN_MSG, 'addUserData')
                    .then(data => this.storeUserData(data))
            }
        }

        this.storeUserData = (data) => chrome.runtime.sendMessage(data)

        this.addDeviceListeners = () => {
            // Add contextual menu listeners
            let activeEl = null
            document.addEventListener('contextmenu', e => {
                activeEl = e.target
            })

            chrome.runtime.onMessage.addListener((message, sender) => {
                if (sender.id !== chrome.runtime.id) return

                switch (message.type) {
                case 'ddgUserReady':
                    scanForInputs(this)
                    break
                case 'contextualAutofill':
                    setValue(activeEl, message.alias)
                    activeEl.classList.add('ddg-autofilled')
                    this.refreshAlias()

                    // If the user changes the alias, remove the decoration
                    activeEl.addEventListener(
                        'input',
                        (e) => e.target.classList.remove('ddg-autofilled'),
                        {once: true}
                    )
                    break
                default:
                    break
                }
            })
        }

        this.addLogoutListener = (handler) => {
            // Cleanup on logout events
            chrome.runtime.onMessage.addListener((message, sender) => {
                if (sender.id === chrome.runtime.id && message.type === 'logout') {
                    handler()
                }
            })
        }

        this.attachTooltip = createAttachTooltip(this.getAlias, this.refreshAlias)
    }
}

class AndroidInterface {
    constructor () {
        this.getAlias = () => sendAndWaitForAnswer(() =>
            window.EmailInterface.showTooltip(), 'getAliasResponse')
            .then(({alias}) => alias)

        this.refreshAlias = () => {}

        this.isDeviceSignedIn = () => new Promise(resolve =>
            resolve((window.EmailInterface.isSignedIn() === 'true')))

        this.trySigningIn = () => {
            if (isDDGDomain()) {
                sendAndWaitForAnswer(SIGN_IN_MSG, 'addUserData')
                    .then(data => {
                        // This call doesn't send a response, so we can't know if it succeded
                        this.storeUserData(data)
                        scanForInputs(this)
                    })
            }
        }

        this.storeUserData = ({addUserData: {token, userName}}) =>
            window.EmailInterface.storeCredentials(token, userName)

        this.addDeviceListeners = () => {}

        this.addLogoutListener = () => {}

        this.attachTooltip = createAttachTooltip(this.getAlias)
    }
}

class AppleDeviceInterface {
    constructor () {
        if (isDDGDomain()) {
            // Tell the web app whether we're in the app
            notifyWebApp({isApp})
        }
        this.getAlias = () => sendAndWaitForAnswer(() =>
            window.webkit.messageHandlers['emailHandlerGetAlias'].postMessage({
                requiresUserPermission: !isApp,
                shouldConsumeAliasIfProvided: !isApp
            }), 'getAliasResponse').then(({alias}) => alias)

        this.refreshAlias = () => window.webkit.messageHandlers['emailHandlerRefreshAlias'].postMessage({})

        this.isDeviceSignedIn = () => sendAndWaitForAnswer(() =>
            window.webkit.messageHandlers['emailHandlerCheckAppSignedInStatus'].postMessage({}),
        'checkExtensionSignedInCallback'
        ).then(data => data.isAppSignedIn)

        this.trySigningIn = () => {
            if (isDDGDomain()) {
                sendAndWaitForAnswer(SIGN_IN_MSG, 'addUserData')
                    .then(data => {
                        // This call doesn't send a response, so we can't know if it succeded
                        this.storeUserData(data)
                        scanForInputs(this)
                    })
            }
        }

        this.storeUserData = ({addUserData: {token, userName}}) =>
            window.webkit.messageHandlers['emailHandlerStoreToken'].postMessage({ token, username: userName })

        this.addDeviceListeners = () => {
            window.addEventListener('message', (e) => {
                if (e.origin !== window.origin) return

                if (e.data.ddgUserReady) {
                    scanForInputs(this)
                }
            })
        }

        this.addLogoutListener = () => {}

        this.attachTooltip = createAttachTooltip(this.getAlias, this.refreshAlias)
    }
}

const DeviceInterface = (() => {
    if (isDDGApp) {
        return isAndroid ? new AndroidInterface() : new AppleDeviceInterface()
    }
    return new ExtensionInterface()
})()

module.exports = DeviceInterface