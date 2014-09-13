'use strict';

var io = require('socket.io-client');
var proxyFactory = require('cjh-remoteServices').proxyFactory;
var Promise = require('rsvp').Promise;

module.exports = function (baseURL, options) {
  var socket = io(baseURL, options);

  var status = ['connecting'];
  var proxies = [];

  var connectProxy = function (proxy) {
    socket.emit('connectToService', proxy.serviceName, function (serviceStatus) {
      var error;
      if (serviceStatus === true) {
        if (status[0] === 'connected') {
          proxy.proxy[proxy.stateProperty] = status;
          proxy.proxy.emit(proxy.connectedEvent);
        }
      } else if (serviceStatus === false) {
        error = new module.exports.ServiceNotFoundError(baseURL, proxy.serviceSpec, proxy.serviceName, proxy.proxy);
        proxy.proxy[proxy.stateProperty] = ['connectFailed', error];
        proxy.proxy.emit(proxy.connectFailedEvent, error);
      } else {
        proxy.proxy[proxy.stateProperty] = ['connectFailed', serviceStatus];
        proxy.proxy.emit(proxy.connectFailedEvent, serviceStatus);
      }
    });
  };

  socket.on('connect', function () {
    status = ['connected'];

    proxies.forEach(function (proxy) {
      connectProxy(proxy);
    });
  });
  socket.on('connect_error', function (error) {
    status = ['connectFailed', error];

    proxies.forEach(function (proxy) {
      proxy.proxy[proxy.stateProperty] = status;
      proxy.proxy.emit(proxy.connectFailedEvent, error);
    });
  });

  socket.on('connect_timeout', function () {
    var timeoutError = new module.exports.TimeoutError(baseURL);

    status = ['connectFailed', timeoutError];

    proxies.forEach(function (proxy) {
      proxy.proxy[proxy.stateProperty] = status;
      proxy.proxy.emit(proxy.connectFailedEvent, timeoutError);
    });
  });
  socket.on('reconnect', function () {
    status = ['connected'];

    proxies.forEach(function (proxy) {
      connectProxy(proxy);
    });
  });
  socket.on('reconnect_attempt', function () {
    status = ['connecting'];

    proxies.forEach(function (proxy) {
      proxy.proxy[proxy.stateProperty] = status;
      proxy.proxy.emit(proxy.connectingEvent);
    });
  });
  socket.on('reconnecting', function (reconnectNumber) {
    status = ['connecting', null, reconnectNumber];

    proxies.forEach(function (proxy) {
      proxy.proxy[proxy.stateProperty] = status;
      proxy.proxy.emit(proxy.connectingEvent);
    });
  });
  socket.on('reconnect_error', function (error) {
    status = ['connectFailed', error];

    proxies.forEach(function (proxy) {
      proxy.proxy[proxy.stateProperty] = status;
      proxy.proxy.emit(proxy.connectFailedEvent, error);
    });
  });
  socket.on('reconnect_failed', function () {
    status = ['connectFailed'];

    proxies.forEach(function (proxy) {
      proxy.proxy[proxy.stateProperty] = status;
      proxy.proxy.emit(proxy.connectFailedEvent);
    });
  });


  return function (serviceSpec, name) {
    var serviceName = name || serviceSpec.name;

    var eventProxyHandler = function (serviceName, eventName, eventSpec, handler) {
      socket.on(serviceName + '/' + eventName, handler);
    };
    var methodProxyFactory = function (serviceName, methodName) {
      var fqMethodName = serviceName + '/' + methodName;

      return function (args) {
        return new Promise(function (resolve, reject) {
          socket.emit(fqMethodName, args, function (ret, err) {
            if (err) {
              reject(err);
            } else {
              resolve(ret);
            }
          });
        });
      };
    };

    var remoteProxy = proxyFactory.remoteProxyFactory(serviceSpec, serviceName, eventProxyHandler, methodProxyFactory);
    var proxy = {
      proxy: remoteProxy,
      serviceSpec: serviceSpec,
      serviceName: serviceName,
      stateProperty: serviceSpec.stateProperty || 'state',
      connectedEvent: serviceSpec.connectedEvent || 'connected',
      connectFailedEvent: serviceSpec.connectFailedEvent || 'connectFailed',
      connectingEvent: serviceSpec.connectingEvent || 'connecting'
    };

    proxies.push(proxy);
    remoteProxy[serviceSpec.connectMethod || 'connect'] = function () {
      if (status[0] === 'connectFailed' || status[0] === 'disconnected') {
        socket.connect();
      }
    };
    remoteProxy[serviceSpec.disconnectMethod || 'disconnect'] = function () {
      if (status[0] === 'connected' || status[0] === 'connecting') {
        socket.disconnect();
        remoteProxy.emit(serviceSpec.disconnectedEvent || 'disconnected');
      }
    };

    if (status[0] === 'connected') {
      connectProxy(proxy);
    }

    return remoteProxy;
  };
};

module.exports.TimeoutError = function (baseURL) {
  this.message = 'Connection timeout';
  this.baseURL = baseURL;
  this.stack = (new Error()).stack;
};
module.exports.TimeoutError.prototype = Object.create(Error.prototype);
module.exports.TimeoutError.prototype.name = 'TimeoutError';

module.exports.ServiceNotFoundError = function (baseURL, serviceSpec, serviceName, remoteProxy) {
  this.message = 'Service "' + serviceName + '" not found';
  this.baseURL = baseURL;
  this.serviceSpec = serviceSpec;
  this.serviceName = serviceName;
  this.remoteProxy = remoteProxy;
  this.stack = (new Error()).stack;
};
module.exports.ServiceNotFoundError.prototype = Object.create(Error.prototype);
module.exports.ServiceNotFoundError.prototype.name = 'ServiceNotFoundError';