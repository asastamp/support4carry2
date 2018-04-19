//------------------------HTTP-PROXY-----------------------------------
var http = require('http');
var proxy = require('http-proxy');
var request = require('request');

// Define the servers to load balance.
var servers = [
  {host: 'localhost', port: 8080},
  {host: 'localhost', port: 8081}
];

var failoverTimer = [];
http.globalAgent.maxSockets = 10240;
// Create a proxy object for each target.
var proxies = servers.map(function (target) {
  return new proxy.createProxyServer({
    target: target,
    ws: true, // enable websocket communication
    down: false //for failover
  });
});


var selectServer = function() {
  var index=0;
   if (proxies[0].options.down) {
    index = 1;
  }
  return index;
};
/**
 *
**/
var startFailover = function(index) {
  if (failoverTimer[index]) {
    return;
  }

  failoverTimer[index] = setTimeout(function() {
    // Check if the server is up or not
    request({
      url: 'http://' + proxies[index].options.target.host + ':' + proxies[index].options.target.port,
      method: 'HEAD',
      timeout: 1000
    }, function(err, res, body) {
      failoverTimer[index] = null;

      if (res && res.statusCode === 200) {
        proxies[index].options.down = false;
        console.log('Server #' + index + ' is back up.');
      } else {
        proxies[index].options.down = true;
        startFailover(index);
        console.log('Server #' + index + ' is still down.');
      }
    });
  }, 1000);
};

/* connect to main server and send the http request.
**/

var server = http.createServer(function(req,res) {
  var proxyIndex = selectServer();
  var proxy = proxies[proxyIndex];
  proxy.web(req, res);
  //start failover operation on error
  proxy.on('error', function(err) {
    startFailover(proxyIndex);
  });
});
server.listen(3000);
console.log('started proxy on port 3000');
