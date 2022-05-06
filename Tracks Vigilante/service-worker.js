( function () {
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
   * @property {TrackEvent[]} urlArray - The triggered events
   */

  /** @type {TrackStorage} */
  const storage = {
    urlArray: [],
  };

  let vigilanteStatus = 'running';

  const minTimeBetweenScreenshots = 1;
  let lastTimeScreenshot = Math.floor( Date.now() / 1000 );
  let lastScreenshot = null;
  chrome.tabs.captureVisibleTab( null, { format: 'jpeg', quality: 35 }, function ( data ) {
    lastScreenshot = data;
  } );

  async function shouldGenerateScreenshot () {
    return new Promise( ( resolve, reject ) => {
      const now = Math.floor( Date.now() / 1000 );
      if ( ( now - lastTimeScreenshot ) >= minTimeBetweenScreenshots ) {
        lastTimeScreenshot = Math.floor( Date.now() / 1000 );
        chrome.tabs.captureVisibleTab( null, { format: 'jpeg', quality: 35 }, function ( data ) {
          lastScreenshot = data;
          resolve( data );
          return data;
        } );
      }
      resolve( lastScreenshot );
      return lastScreenshot;
    } );
  }

  /**
   * Get Vigilante Status
   */
  async function getVigilanteStatus () {
    return new Promise( ( resolve, reject ) => {
      chrome.storage.local.get( 'vigilanteStatus', ( result ) => {
        const error = chrome.runtime.lastError;
        if ( error ) {
          return reject( error );
        }

        Object.assign( vigilanteStatus, result );
        chrome.contextMenus.update(
          'vigilanteStatus',
          {
            checked: vigilanteStatus === 'running',
          }
        );
        updateBadge( storage?.urlArray );
        resolve();
      } );
    } );
  };

  chrome.contextMenus.removeAll();
  chrome.contextMenus.create( {
    title: 'Running',
    id: 'vigilanteStatus',
    type: 'checkbox',
    checked: true,
    contexts: [ 'action' ],
  } );

  chrome.contextMenus.create( {
    title: 'Clear data',
    id: 'clear',
    checked: true,
    contexts: [ 'action' ],
  } );

  chrome.contextMenus.onClicked.addListener(
    ( e ) => {
      if ( e.menuItemId === 'vigilanteStatus' ) {
        if ( vigilanteStatus === 'running' ) {
          vigilanteStatus = 'paused';
        } else {
          vigilanteStatus = 'running';
        }
        getVigilanteStatus();
      }
      if ( ( e.menuItemId === 'clear' ) ) {
        clearData();
      }
    }
  );

  getVigilanteStatus();

  // See: https://developer.chrome.com/docs/extensions/reference/storage/#asynchronous-preload-from-storage
  chrome.action.onClicked.addListener( async () => {
    try {
      await initStorage();
    } catch ( error ) {
      // Ignore the error
    }
  } );

  chrome.webRequest.onCompleted.addListener( onCompletedListener,
    { urls: [ '*://pixel.wp.com/*' ] }, [ 'responseHeaders' ] );

  chrome.runtime.onMessage.addListener(
    function ( request ) {
      if ( request.msg === 'Clear' ) {
        clearData();
      }
    }
  );

  function hasBeenReplaced ( url ) {
    return url.includes( 'https://pixel.wp.com' ) || url.includes( 'http://pixel.wp.com' );
  }

  /**
   * @param { Event } details for the completed request.
   */
  async function onCompletedListener ( details ) {
    if ( vigilanteStatus !== 'running' ) {
      return;
    }
    let url = details.url.replace( 'https://pixel.wp.com/t.gif?', '' ).replace( 'http://pixel.wp.com/t.gif?', '' );
    let type = '';

    const screenshot = await shouldGenerateScreenshot();

    // TODO A bit ugly filter, to be improved for better readability
    if ( hasBeenReplaced( url ) ) {
      url = details.url.replace( 'https://pixel.wp.com/g.gif?', '' ).replace( 'http://pixel.wp.com/g.gif?', '' );
      if ( hasBeenReplaced( url ) ) {
        url = details.url.replace( 'https://pixel.wp.com/boom.gif?', '' ).replace( 'http://pixel.wp.com/boom.gif?', '' );
        if ( hasBeenReplaced( url ) ) {
          console.log( `Unknown pixel ${ url }` );
          return;
        } else {
          type = 'grafana';
        }
      } else {
        type = 'external';
      }
    } else {
      type = 'tracks-event';
    }
    const urlSearchParams = new URLSearchParams( url );
    const params = Object.fromEntries( urlSearchParams.entries() );

    storeData( params, type, screenshot );
  }

  /**
   * Sends the received data to the popup html (standalone or not)
   *
   * @param { { key, value, type, time }[] } params Data to send
   */
  function sendMessageToVigilante ( params ) {
    chrome.runtime.sendMessage( {
      msg: 'Tracks',
      data: {
        queryParams: params,
      },
    } );
  }

  /**
   *
   * @param { { key, value, type, time }[] } params New data storage
   * @param string type (tracks-event, external, grafana)
   */
  async function storeData ( params, type, screenshot ) {
    const currentDate = new Date();
    const stringDate = currentDate.toLocaleTimeString();
    const urlArray = storage?.urlArray?.slice() || [];

    urlArray.push( { key: params._en, values: params, time: stringDate, type, screenshot } );

    await updateStorage( { urlArray } );
    updateBadge( urlArray );
    sendMessageToVigilante( params );
  }

  /**
   * Clear the data
   */
  async function clearData () {
    await updateStorage( { urlArray: [] } );
    updateBadge( [] );
    sendMessageToVigilante( [] );
  }

  /**
   * Prints the small number in the Tracks Vigilante icon
   *
   * @param {TrackEvent[]} trackEvents our data array
   */
  function updateBadge ( trackEvents ) {
    if ( vigilanteStatus === 'running' ) {
      chrome.action.setBadgeText( { text: trackEvents.length > 0 ? trackEvents.length.toString() : '' } );
    } else {
      chrome.action.setBadgeText( { text: 'STOP' } );
    }
  }

  /**
   * Initialize the storage
   */
  async function initStorage () {
    return new Promise( ( resolve, reject ) => {
      chrome.storage.local.get( 'urlArray', ( result ) => {
        const error = chrome.runtime.lastError;
        if ( error ) {
          return reject( error );
        }

        Object.assign( storage, result );
        resolve();
      } );
    } );
  }

  /**
   * Update the data
   * @param {TrackStorage} nextStorage The next data storage
   */
  async function updateStorage ( nextStorage ) {
    return new Promise( ( resolve ) => {
      Object.assign( storage, nextStorage );
      chrome.storage.local.set( nextStorage, () => resolve() );
    } );
  }

  // Following code is to "revive" plugin if it has dead because of inactivity
  let lifeline;

  keepAlive();

  chrome.runtime.onConnect.addListener( port => {
    if ( port.name === 'keepAlive' ) {
      lifeline = port;
      setTimeout( keepAliveForced, 295e3 ); // 5 minutes minus 5 seconds
      port.onDisconnect.addListener( keepAliveForced );
    }
  } );

  function keepAliveForced () {
    lifeline?.disconnect();
    lifeline = null;
    keepAlive();
  }

  async function keepAlive () {
    if ( lifeline ) return;
    for ( const tab of await chrome.tabs.query( { url: '*://*/*' } ) ) {
      try {
        await chrome.scripting.executeScript( {
          target: { tabId: tab.id },
          function: () => chrome.runtime.connect( { name: 'keepAlive' } ),
          // `function` will become `func` in Chrome 93+
        } );
        chrome.tabs.onUpdated.removeListener( retryOnTabUpdate );
        return;
      } catch ( e ) { }
    }
    chrome.tabs.onUpdated.addListener( retryOnTabUpdate );
  }

  async function retryOnTabUpdate ( tabId, info, tab ) {
    if ( info.url && ( /^(file|https?):/.test( info.url ) ) ) {
      keepAlive();
    }
  }
} )();
