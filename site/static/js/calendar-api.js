// site/static/js/calendar-api.js
// Thin client for the sangha-worker calendar API. Reads the Worker base from
// #calendar-app[data-calendar-api] and the bearer token from ECBS.Auth.
// If no base is configured, enabled() is false and the calendar stays local.
(function () {
  "use strict";
  var ECBS = (window.ECBS = window.ECBS || {});

  function apiBase() {
    var root = document.getElementById("calendar-app");
    var base = root ? root.getAttribute("data-calendar-api") : "";
    return (base || "").replace(/\/+$/, "");
  }

  function authToken() {
    return (ECBS.Auth && ECBS.Auth.getToken && ECBS.Auth.getToken()) || null;
  }

  function headers(withJson) {
    var h = {};
    if (withJson) h["Content-Type"] = "application/json";
    var token = authToken();
    if (token) h["Authorization"] = "Bearer " + token;
    return h;
  }

  function enabled() {
    return Boolean(apiBase());
  }

  function fetchImplFrom(options) {
    return (options && options.fetch) || window.fetch.bind(window);
  }

  async function responseError(res, fallback) {
    var payload = null;
    try { payload = await res.json(); } catch (error) {}
    var err = new Error(payload && payload.error ? payload.error : fallback + ": " + res.status);
    err.status = res.status;
    err.code = payload && payload.error ? payload.error : "";
    err.payload = payload;
    return err;
  }

  async function fetchStore(options) {
    var res = await fetchImplFrom(options)(apiBase() + "/api/calendar", { headers: headers(false) });
    if (!res.ok) throw await responseError(res, "fetch calendar failed");
    return res.json();
  }

  async function putStore(store, revision, options) {
    var res = await fetchImplFrom(options)(apiBase() + "/api/calendar", {
      method: "PUT",
      headers: headers(true),
      body: JSON.stringify({ store: store, revision: revision })
    });
    if (res.status === 409) {
      var conflict = await res.json();
      var err = new Error("revision_conflict");
      err.conflict = conflict;
      throw err;
    }
    if (!res.ok) throw await responseError(res, "put calendar failed");
    return res.json();
  }

  async function postSignup(payload, options) {
    var res = await fetchImplFrom(options)(apiBase() + "/api/signups", {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw await responseError(res, "signup failed");
    return res.json();
  }

  async function deleteSignup(payload, options) {
    var res = await fetchImplFrom(options)(apiBase() + "/api/signups", {
      method: "DELETE",
      headers: headers(true),
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw await responseError(res, "cancel signup failed");
    return res.json();
  }

  ECBS.CalendarApi = {
    apiBase: apiBase,
    enabled: enabled,
    fetchStore: fetchStore,
    putStore: putStore,
    postSignup: postSignup,
    deleteSignup: deleteSignup
  };
})();
