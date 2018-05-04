var app = require('express')();
const commandLineArgs = require('command-line-args');

const options = commandLineArgs([
  { name: 'redis', alias: 'r', type: String,defaultValue:"localhost:6379" },
  { name: 'port', alias:'p', type: Number},
]);

var redisAddress = options.redis.split(':');
var redis = require('redis').createClient({host:redisAddress[0],port:redisAddress[1]});

var server = require('http').Server(app);
var io = require('socket.io')(server);
const moment = require('moment');
var adapter = require('socket.io-redis');
io.adapter(adapter({host:redisAddress[0],port:redisAddress[1]}));
var port= options.port || 8080;
server.listen(port);

require('./routes')(app, io);

var storeMessage = function(name, data, time, type, messages_group) {
    var message = JSON.stringify({
        name: name,
        data: data,
        time: time,
        type: type
    });

    redis.lpush(messages_group, message, function(err, response) {

    });
};


var chatRoom = io.on('connection',function(socket){
	console.log('Client connected...');

	  socket.on('login',function(clientid){
		socket.clientid = clientid;
		socket.groupid = 'GlobalChat';
		socket.join('GlobalChat');
    redis.sadd("clients",clientid);

		var groupList_clientid = "group_" + clientid;

        redis.smembers(groupList_clientid, function(err,groupList_clientid) {
            groupList_clientid.forEach(function(groupid) {
                socket.emit('add-group-list', groupid);
        	  });
        });
	});

	socket.on('createGroup',function(groupid){
		var clientid = socket.clientid;

        redis.sismember("groupList", groupid, function(err, reply) {
            if (reply === 1) {
                socket.emit('modal-toggle', "The group ID \""+ groupid +"\" already exists!");
            } else {
		        redis.sadd("groupList",groupid);
		        redis.sadd("client_"+groupid,clientid);
		        redis.sadd("group_"+clientid,groupid);
                socket.emit('add-group-list', groupid);
                socket.emit('joinGroup', groupid);
            }
        });
	});

	socket.on('joinGroup',function(groupid){
        if(groupid==socket.groupid) return;
        redis.sismember("groupList", groupid, function(err, reply) {
            if (reply === 1) {
                var clientid = socket.clientid;
                var messagepack =
                {
                    message: clientid + ' break group ',
                    type: 'noti'
                }
                socket.broadcast.to(socket.groupid).emit('noti-receive', messagepack);
                socket.leave(socket.groupid);

		        socket.join(groupid);
		        socket.groupid = groupid;

                var messages_group = "messages_" + groupid;
                var mesCount = 0;

                //---------------set first time----------------
                var firstRead = 0;
                var key_firstRead = "first-read-"+groupid+"_"+clientid;
                var message_length = 0;

                redis.llen(messages_group,function(err, value) {
                    message_length = value+1;
                });

                console.log("message_length :  "+message_length);
                if(redis.exists(key_firstRead)) {
                    redis.get(key_firstRead, function(err, value) {
                        if(value == -1 || value==null) {
                            redis.set(key_firstRead, message_length);
                            console.log("set1 : "+key_firstRead + "  ======  "+message_length);
                            firstRead = message_length;
                        }
                        else firstRead = value;
                    });
                }
                else {
                    redis.set(key_firstRead, message_length);
                    firstRead = message_length;
                    console.log("set2 : "+key_firstRead + "  ======  "+message_length);
                }
                //-------------------END-----------------------

                redis.get("last-read-"+groupid+"_"+clientid, function(err, value) {
                    if(isNaN(value))
                    {
                        var lastRead = 0;
                        redis.set("last-read-"+groupid+"_"+clientid, lastRead);
                    }
                    else
                        var lastRead = parseInt(value) + 1;

                    if (err) {
                        console.error("error last read");
                    } else {
                        redis.lrange(messages_group, 0, -1, function(err, messages) {
                        messages = messages.reverse();

                        messages.forEach(function(message) {
                            message = JSON.parse(message);
                            if(message.type === 'noti')
                            {
                                var messagepack =
                                {
                                    message: message.data,
                                    time: message.time,
                                    avatarName : message.name,
                                    type: message.type
                                }
                                socket.emit("noti-receive", messagepack);
                            }
                            else
                            {
                                //unread message notification
                                mesCount++;
                                console.log("mesCount "+ mesCount + " lastRead" + lastRead);

                                    if(mesCount == lastRead)
                                    {
                                        console.log("detect unRead of "+ clientid + lastRead);
                                        var messagepack =
                                        {
                                            message: "unread messages below."
                                        }
                                        socket.emit("noti-receive", messagepack);
                                    }

                                    var messagepack =
                                    {
                                        message: message.name + ': ' + message.data,
                                        time: message.time,
                                        avatarName : message.name,
                                        type: message.type
                                    }
                                if (mesCount >= firstRead) {
                                    if(message.name == socket.clientid)
                                        socket.emit("self_receive_no_update_unread", messagepack);
                                    else
                                        socket.emit("receive_no_update_unread", messagepack);
                                }
                                else socket.emit("count_Read");
                            }
                            redis.set("last-read-"+groupid+"_"+clientid, mesCount);
                            });
                        });
                    }
                });

                redis.sadd("groupList",groupid);
		            redis.sadd("client_"+groupid,clientid);
		            redis.sadd("group_"+clientid,groupid);
                socket.emit('add-group-list', groupid);
                socket.emit('join-success', groupid);

            }
            else {
                socket.emit('modal-toggle', "The group ID \""+ groupid +"\" does not exist!");
            }
        });
	});

	socket.on('message',function(message){
        var clientid = socket.clientid;
        var groupid = socket.groupid;
        var messages_group = "messages_" + groupid;
        var time = moment().format('HH:mm:ss');

        var messagepack =
                {
                     message: clientid + ' : ' + message,
                     time: time,
                     avatarName : clientid,
                     type: 'message'
                }
        socket.broadcast.to(groupid).emit('receive', messagepack);
        socket.emit('self_receive', messagepack);
        storeMessage(clientid, message, time, 'message', messages_group);
	});

    socket.on('join-noti',function(){
        var clientid = socket.clientid;
        var groupid = socket.groupid;
        var messages_group = "messages_" + groupid;
        var time = moment().format('HH:mm:ss');

        var messagepack =
                {
                     message: clientid + ' has joined the chat! ',
                     type: 'noti'
                }
        socket.broadcast.to(groupid).emit('noti-receive', messagepack);
	});

    socket.on('leave-group',function(){
        var clientid = socket.clientid;
        var groupid = socket.groupid;
        var time = moment().format('HH:mm:ss');
        var messagepack =
        {
            message: clientid + ' has left the chat permanently!',
                     type: 'noti'
        }
        socket.broadcast.to(groupid).emit('noti-receive', messagepack);
		    redis.srem("client_"+groupid,clientid);
		    redis.srem("group_"+clientid,groupid);
		    socket.leave(socket.groupid);
        socket.join('GlobalChat');
        socket.groupid = 'GlobalChat';

        var key_firstRead = "first-read-"+groupid+"_"+clientid;
        redis.set(key_firstRead, -1);
	});

    socket.on('update-unread', function(value){
		redis.set("last-read-"+socket.groupid+"_"+socket.clientid, value);
        console.log("last read of" + socket.clientid + " " + value);
	});

	socket.on('disconnect',function(data){
        var messagepack =
            {
                message: socket.clientid + ' has been disconnected! ',
                type: 'noti'
            }
        socket.broadcast.to(socket.groupid).emit('noti-receive', messagepack);
		socket.leave(socket.groupid);
	});

});

console.log("Server has started on http://localhost:" + port);
