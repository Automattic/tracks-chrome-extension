(function () {
  'use strict';

  /**
   * The event data
   * @typedef {Object} TrackEvent
   * @property {string} key - The name of event
   * @property {Object} values - The properties of the event
   * @property {string} type - One of tracks-event, external, grafana
   * @property {string} time - The string of timestamp
   */

  /**
   * The storage data
   * @typedef {Object} TrackStorage
   * @property {TrackEvent[]} url_array - The triggered events
   */

  /** @type {TrackStorage} */
  const storage = {
    url_array: [],
  };

  // See: https://developer.chrome.com/docs/extensions/reference/storage/#asynchronous-preload-from-storage
  browser.browserAction.onClicked.addListener(async () => {
    try {
      await initStorage();
    } catch ( error ) {
      // Ignore the error
    }
  })

  chrome.webRequest.onCompleted.addListener(onCompletedListener,
    { urls: ["*://pixel.wp.com/*",] }, ['responseHeaders']);

  chrome.runtime.onMessage.addListener(
    function (request) {
      if ( request.msg === "Clear" ) {
        clearData();
      }
    }
  )

  function hasBeenReplaced( url ) {
    return url.includes( "https://pixel.wp.com" ) || url.includes( "http://pixel.wp.com" );
  }

  /**
   * 
   * @param { Event } details for the completed request.
   */
  function onCompletedListener( details ) {
    let url = details.url.replace( "https://pixel.wp.com/t.gif?", "" ).replace( "http://pixel.wp.com/t.gif?", "" );
    let type = '';

    //TODO A bit ugly filter, to be improved for better readability
    if ( hasBeenReplaced( url ) ) {
      url = details.url.replace( "https://pixel.wp.com/g.gif?", "" ).replace( "http://pixel.wp.com/g.gif?", "" );
      if ( hasBeenReplaced( url ) ) {
        url = details.url.replace( "https://pixel.wp.com/boom.gif?", "" ).replace( "http://pixel.wp.com/boom.gif?", "" );
        if ( hasBeenReplaced( url )) {
          console.log(`Unknown pixel ${url}`)
          return;
        } else {
          type = "grafana";
        }
      } else {
        type = "external";
      }
    } else {
      type = "tracks-event";
    }
    const urlSearchParams = new URLSearchParams( url );
    const params = Object.fromEntries(urlSearchParams.entries());

    storeData( params, type );
  }

  /**
   * Sends the received data to the popup html (standalone or not)
   * 
   * @param { { key, value, type, time }[] } params Data to send
   */
  function sendMessageToVigilante( params ) {
    chrome.runtime.sendMessage({
      msg: "Tracks",
      data: {
        queryParams: params
      }
    });
  }

  /**
   * 
   * @param { { key, value, type, time }[] } params New data storage
   * @param string type (tracks-event, external, grafana)
   */
  async function storeData( params, type ) {
    let currentDate = new Date();
    let stringDate = currentDate.toLocaleTimeString();
    const url_array = storage?.url_array?.slice() || [];

    url_array.push({ key: params._en, values: params, time: stringDate, type: type })

    await updateStorage( { url_array } );
    updateBadge( url_array );
    sendMessageToVigilante( params );
  }

  /**
   * Clear the data
   */
  async function clearData() {
    await updateStorage( { url_array: [] });
    updateBadge( [] );
    sendMessageToVigilante( [] )
  }

  /**
   * Prints the small number in the Tracks Vigilante icon
   * 
   * @param { TrackEvent[] } trackEvents our data array
   */
  function updateBadge( trackEvents ) {
    browser.browserAction.setBadgeText({ text: trackEvents.length > 0 ? trackEvents.length.toString() : "" });
  }

  /**
   * Initialize the storage
   */
  async function initStorage() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get( 'url_array', ( result ) => {
        const error = chrome.runtime.lastError;
        if ( error ) {
          return reject( error );
        }

        Object.assign(storage, result);
        resolve();
      });
    });
  }

  /**
   * Update the data
   * @param {TrackStorage} nextStorage The next data storage
   */
  async function updateStorage( nextStorage ) {
    return new Promise((resolve) => {
      Object.assign(storage, nextStorage);
      chrome.storage.local.set( nextStorage, () => resolve() );
    })
  }

  //Following code is to "revive" plugin if it has dead because of inactivity
  let lifeline;

  keepAlive();

  chrome.runtime.onConnect.addListener(port => {
    if (port.name === 'keepAlive') {
      lifeline = port;
      setTimeout(keepAliveForced, 295e3); // 5 minutes minus 5 seconds
      port.onDisconnect.addListener(keepAliveForced);
    }
  });

  function keepAliveForced() {
    lifeline?.disconnect();
    lifeline = null;
    keepAlive();
  }

  async function keepAlive() {
    if (lifeline) return;
    for (const tab of await chrome.tabs.query({ url: '*://*/*' })) {
      try {
       browser.tabs.executeScript(
        tab.id,
        { code: `chrome.runtime.connect({ name: 'keepAlive' })` }
       );
        chrome.tabs.onUpdated.removeListener(retryOnTabUpdate);
        return;
      } catch (e) { }
    }
    chrome.tabs.onUpdated.addListener(retryOnTabUpdate);
  }

  async function retryOnTabUpdate(tabId, info, tab) {
    if (info.url && /^(file|https?):/.test(info.url)) {
      keepAlive();
    }
  }
})();