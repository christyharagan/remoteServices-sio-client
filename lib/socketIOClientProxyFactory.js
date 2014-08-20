'use strict';

var socketIO = require('socket.io-client');
var proxyFactory = require('cjh-remoteServices').proxyFactory;
var Promise = require('rsvp').Promise;

module.exports = function (baseURL, serviceSpec) {
  var io = socketIO(baseURL + serviceSpec.name);

  var eventProxyHandler = function (serviceName, eventName, eventSpec, handler) {
    io.on(eventName, handler);
  };
  var methodProxyFactory = function (serviceName, methodName) {
    return function (args) {
      return new Promise(function (resolve, reject) {
        io.emit(methodName, args, function (ret, err) {
          if (err) {
            reject(err);
          } else {
            resolve(ret);
          }
        });
      });
    };
  };

  var stateProperty = serviceSpec.stateProperty || 'state';
  var connectedEvent = serviceSpec.connectedEvent || 'connected';
  var connectFailedEvent = serviceSpec.connectFailedEvent || 'connectFailed';
  var disconnectedEvent = serviceSpec.disconnectedEvent || 'disconnected';
  var connectingEvent = serviceSpec.connectingEvent || 'connecting';
  var connectMethod = serviceSpec.connectMethod || 'connect';
  var disconnectMethod = serviceSpec.disconnectMethod || 'disconnect';

  var remoteProxy = proxyFactory.remoteProxyFactory(serviceSpec, eventProxyHandler, methodProxyFactory);
  remoteProxy[stateProperty] = 'connecting';

  io.on('connect', function () {
    remoteProxy[stateProperty] = ['connected'];
    remoteProxy.emit(connectedEvent);
  });
  io.on('connect_error', function (error) {
    remoteProxy[stateProperty] = ['connectFailed', error];
    remoteProxy.emit(connectFailedEvent, error);
  });
  io.on('connect_timeout', function () {
    var timeoutError = new module.exports.TimeoutError(baseURL, serviceSpec, remoteProxy);
    remoteProxy[stateProperty] = ['connectFailed', timeoutError];
    remoteProxy.emit(connectFailedEvent, timeoutError);
  });
  io.on('reconnect', function () {
    remoteProxy[stateProperty] = ['connected'];
    remoteProxy.emit(connectedEvent);
  });
  io.on('reconnect_attempt', function () {
    remoteProxy[stateProperty] = ['connecting'];
    remoteProxy.emit(connectingEvent);
  });
  io.on('reconnecting', function (reconnectNumber) {
    remoteProxy[stateProperty] = ['connecting', null, reconnectNumber];
    remoteProxy.emit(connectingEvent);
  });
  io.on('reconnect_error', function (error) {
    remoteProxy[stateProperty] = ['connectFailed', error];
    remoteProxy.emit(connectFailedEvent, error);
  });
  io.on('reconnect_failed', function () {
    remoteProxy[stateProperty] = ['connectFailed'];
    remoteProxy.emit(connectFailedEvent);
  });

  remoteProxy[connectMethod] = function () {
    var state = remoteProxy[stateProperty];
    if (state === 'connectFailed' || state === 'disconnected') {
      io.connect();
    }
  };
  remoteProxy[disconnectMethod] = function () {
    var state = remoteProxy[stateProperty];
    if (state === 'connected' || state === 'connecting') {
      io.disconnect();
      remoteProxy.emit(disconnectedEvent);
    }
  };

  return remoteProxy;
};

module.exports.TimeoutError = function (baseURL, serviceSpec, remoteProxy) {
  this.message = 'Connection timeout';
  this.baseURL = baseURL;
  this.serviceSpec = serviceSpec;
  this.remoteProxy = remoteProxy;
  this.stack = (new Error()).stack;
};
module.exports.TimeoutError.prototype = Object.create(Error.prototype);
module.exports.TimeoutError.prototype.name = 'TimeoutError';