(function () {
    'use strict';

    /**
     * noop function
     */
    const noop = () => {};

    /**
     * Hear for messegas sent from service-worker.js
     */
    chrome.runtime.onMessage.addListener(
        function (request) {
            if (request.msg === "Tracks") {
                reload();
            }
        }
    );

    /**
     * Elements declaration
     */
    const clearButton = document.getElementById("clear");
    const standaloneButton = document.getElementById("standalone");
    const reloadButton = document.getElementById("reload");
    const table = document.getElementById("table");
    const filter = document.getElementById("filter");
    const extended = document.getElementById("extended");
    const select = document.getElementById("select-container");

    /**
     * Event Listeners declaration
     */
    clearButton.addEventListener("click", clearContents);
    standaloneButton?.addEventListener("click", openStandalone);
    reloadButton.addEventListener("click", reload);
    extended.addEventListener("click", reload);
    filter.addEventListener("input", reload);
    document.querySelectorAll('input[name="type"]').forEach((elem) => {
        elem.addEventListener("change", function () {
            reload();
        });
    });

    /**
     * Elements init values
     */
    let filterProperty = '';
    let selectorValue = 'ALL';
    if (standaloneButton == null) {
        extended.checked = true;
    }

    /**
     * Clear table contents by clearing Chrome Extension storage.
     * It also sets the badge in the Chrome Extension Icon to 0.
     */
    function clearContents() {
        chrome.runtime.sendMessage({ msg: "Clear" });
        reload();
    }

    /**
     * Event implementation to change Keys in the dropdown selector
     * @param {Event} event 
     */
    function filterSelector( event ) {
        selectorValue = event?.target?.value?.trim();
        reload();
    }

    /**
     * Creates a component for choosing Keys.
     * @returns string HTML to create a <Select/> 
     */
    function createKeySelector( data) {
        return `
        <select name="keys" id="keys">
            <option value="ALL">ALL</option>
            ${getFilters( data )}
        </select>`;
    }

    /**
     * Main render function
     * @param { { key, value, type, time }[] } result Object containing events caught to fill Table contents 
     */
    function renderTable( result ) {
        fillTableData( result?.url_array );
        select.innerHTML = createKeySelector( result?.url_array );
        selectorEvents();
        if (standaloneButton != null) {
            document.body.style.minWidth = extended.checked ? "1200px" : "800px";
        }
    }

    /**
     * Main function to get data, process it, fill table and filter values
     */
    function reload() {
        chrome.storage.local.set({ filter: filter?.value }, noop );
        chrome.storage.local.get('url_array', renderTable);
    }

    /**
     * Renders all rows for the main table
     * @param { { key, value, type, time }[] } params 
     * @returns 
     */
    function fillTableData( params ) {
        const typeSelected = document.querySelector('input[name="type"]:checked').value;
        filterProperty = filter.value;
        table.innerHTML = null;
        let html = '';

        if (!!!params) {
            return;
        }
        params = params.reverse();
        params.forEach(element => {
            let customKey = element.key;
            let parameters = [];
            let extendedParameters = [];
            if (element.key == selectorValue || selectorValue == '' || selectorValue == "ALL") {
                for (const [key, value] of Object.entries(element.values)) {
                    if (typeSelected == "ALL" || typeSelected == element.type) {
                        if (filterProperty == '' || filterProperty == null || key.toLowerCase().includes(filterProperty.toLowerCase())
                            || value.toLowerCase().includes(filterProperty.toLowerCase())) {
                            customKey = processDataElement(key, element, parameters, value, customKey, extendedParameters);
                        }
                    }
                }
                if (parameters.length > 0 || extendedParameters.length > 0) {
                    html += generateRow(customKey, parameters, extendedParameters, element.time, element.type);
                }
            }
        });
        table.innerHTML = `
            <tr>
                <th>Key</th>
                <th>Properties</th>
                ${extended.checked ? `<th class="extended">Extended properties</th>` : ''}
            </tr>${html}`;
    }

    /**
     * 
     * @param string key 
     * @param { { key, value, type, time } } element 
     * @param { { key, value, type, time }[] } parameters 
     * @param string value 
     * @param string customKey Used when Key is not for Tracks
     * @param { { key, value, type, time }[] } extendedParameters Extended parameters column
     * @returns { string } in case that we need a custom key, we return it
     */
    function processDataElement( key, element, parameters, value, customKey, extendedParameters ) {
        if (!key.startsWith("_")) {
            if (element.type == "tracks-event") {
                parameters.push({ key: key, value: value });
            } else if (element.type == "external") {
                if (key != "v") {
                    parameters.push({ key: key, value: value });
                } else {
                    customKey = value;
                }
            } else if (element.type == "grafana") {
                parameters.push({ key: "error", value: value });
            }
        } else {
            extendedParameters.push({ key: key, value: value });
        }
        return customKey;
    }

    /**
     * Generates a single row for the main table
     * @param { string } key First column
     * @param { { key, value }[] } properties Second column
     * @param { { key, value }[] } extendedProperties Third column
     * @param { string } time Time displayed under first column data
     * @param { string } eventType Used to render row in one way or another
     * @returns { string } HTML string representing a row
     */
    function generateRow( key, properties, extendedProperties, time, eventType ) {
        return `
            <tr class="row">
                <td class="key ${eventType}">
                    ${generateKey(key, time, eventType)}
                </td>
                <td class="properties">
                    ${generateProperties(properties)}
                </td>
                ${extended.checked ?
                        `<td class="extended">
                        ${generateProperties(extendedProperties)}
                    </td>` : ''
                    }
                
            </tr>`
    }

    /**
     * Generates the first column for the table, given a Key, timestamp and event type
     * 
     * @param string key 
     * @param string time 
     * @param string eventType 
     * @returns HTML string
     */
    function generateKey( key, time, eventType ) {
        let trackPage = `<a href="https://mc.a8c.com/tracks/live/?eventname=${ key }" target="_blank">${ key }</a>`
        if ( eventType === "external" ) {
            trackPage = key;
        } else if ( eventType === "grafana" ) {
            trackPage = "Error"
        }
        return `<strong class="no-margin ${ eventType }">${ trackPage }<p class="no-margin">${ time }<p></strong>`
    }

    /**
     * Given an array of properties generates the contents for a column with properties
     * 
     * @param { { key, value }[] } properties 
     * @returns { string } HTML string
     */
    function generateProperties( properties ) {
        let html = '';
        properties.forEach(element => {
            html += generateProperty( element );
        });
        return html;
    }

    /**
     * Gien a property it identifies if needs linking, adds classes to it and returns a <p/>
     * 
     * @param { { key, value } } property 
     * @returns { string } HTML string
     */
    function generateProperty( property ) {
        let link = ["_ui", "_ul"].some(t => t == property.key) ? `${property.value}<a class="store-admin" href="https://wordpress.com/wp-admin/network/admin.php?page=store-admin&action=search&username=${property.value}"> Store admin</a>` : property.value;
        link = ["_dl", "_dr"].some(t => t == property.key) ? `<a class="store-admin" href="${property.value}"> ${property.value}</a>` : link;
        return `<p class="no-margin"><strong>${property.key}</strong>: ${link}</p>`
    }

    /**
     * Builds the options for a <Select/> component
     * 
     * @param { { key, value, type, time }[] } params 
     * @returns 
     */
    function getFilters( params ) {
        let html = '';
        let unique = params.map(t => t.key);
        unique = [...new Set(unique)];
        unique.forEach(element => {
            if (!element) {
                return;
            }
            html += `<option value="${element}" ${element == selectorValue ? 'selected' : ''}>${element}</option>`;
        });
        return html;
    }

    /**
     * Rebuilds events listeners for the <Select/> component
     */
    function selectorEvents() {
        let selector = document.getElementById("keys");
        selector?.removeEventListener("change", filterSelector);
        selector?.addEventListener("change", filterSelector);
        selector = document.getElementById("keys");
    }

    /**
     * Helper function to open a popup window
     * 
     * @param string url url for the popup
     * @param string windowName window title
     * @param number w width of the popup
     * @param number h height of the popup
     * @returns 
     */
    function popupWindow(url, windowName, w, h) {
        const y = window.top.outerHeight / 2 + window.top.screenY - (h / 2);
        const x = window.top.outerWidth / 2 + window.top.screenX - (w / 2);
        return window.open(url, windowName, `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=${w}, height=${h}, top=${y}, left=${x}`);
    }

    /**
     * Open a standalone popup for better visualization of the events
     */
    function openStandalone() {
        popupWindow("popup-standalone.html", 'Vigilante', 1300, 800);
        window.close();
    }

    reload();
    selectorEvents();
})();


