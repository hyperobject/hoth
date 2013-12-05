var Hoth = (function() {
  'use strict';

  var el = function(cl, tag) {
    var d = document.createElement(tag || 'div');
    d.className = cl || '';
    return d;
  };

  var pad = function(ch, n, s) {
    return Array(n + 1).join(ch).slice(s.length) + s;
  };

  var formatTime = function(d) {
    return d.getHours() + ':' + pad('0', 2, '' + d.getMinutes());
  };

  var escapeXML = function(string) {
    return string.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/, '&apos;');
  };

  var RE_HASHTAG = /^(#([^\s{}]+?)|!(\w+))([\.!?"',;:\)\]]*(\s|$))/;

  var parse = function(string) {
    string = string.trim();
    var result = '';
    var i = 0;
    while (i < string.length) {
      var x;
      if (x = RE_HASHTAG.exec(string.slice(i))) {
        if (x[2]) {
          result += '<a href="#' + escapeXML(x[2]) + '">#' + escapeXML(x[2]) + '</a>';
        } else {
          result += '<a href="#' + escapeXML(JSON.stringify({ goto: '!' + x[3] })) + '">(thread)</a>';
        }
        result += escapeXML(x[4]);
        i += x[0].length;
      } else {
        var j = string.slice(i + 1).search(/[#!]/);
        if (j === -1) {
          j = string.length;
        } else {
          j += i + 1;
        }
        result += escapeXML(string.slice(i, j));
        i = j;
      }
    }
    return result;
  };

  var Thread = function(data) {
    this.messages = [];
    this.shouldAutoscroll = true;
    this.contentSize = 0;
    this.dragging = false;
    this.$scroll = 0;
    this.$prompt = null;

    this.onScrollMouseMove = this.onScrollMouseMove.bind(this);
    this.onScrollMouseUp = this.onScrollMouseUp.bind(this);

    this.template();

    this.name = data.name;
    this.uid = data.uid;

    if (this.id) {
      socket.emit('open thread', this.id);
    } else {
      socket.emit('create thread', function(uid) {
        this.uid = uid;
        Thread.temps[uid] = this;
      }.bind(this));
    }
  };

  Thread.topics = {};
  Thread.temps = {};

  Thread.get = function(id, callback) {
    if (id[0] === '#') {
      callback(Thread.topic(id.slice(1)));
    } else if (id[0] === '!') {
      callback(Thread.temp(id.slice(1)));
    }
  };

  Thread.temp = function(uid) {
    if (Thread.temps[uid]) {
      return Thread.temps[uid];
    }
    return Thread.temps[uid] = new Thread({ uid: uid });
  };

  Thread.topic = function(name) {
    if (Thread.topics[name]) {
      return Thread.topics[name];
    }
    return Thread.topics[name] = new Thread({
      name: name
    });
  };

  Thread.prototype.template = function() {
    this.element = el('hoth-thread');
    this.element.appendChild(this.elName = el('hoth-thread-name'));
    this.element.appendChild(this.elContent = el('hoth-thread-content'));
    this.elContent.appendChild(this.elScrollbar = el('hoth-thread-scrollbar'));
    this.elScrollbar.appendChild(this.elMarkers = el('hoth-thread-markers'));
    this.elScrollbar.appendChild(this.elScrollbarHandle = el('hoth-thread-scrollbar-handle'));
    this.elContent.appendChild(this.elWrap = el('hoth-thread-wrap'));
    this.elWrap.appendChild(this.elMessages = el('hoth-thread-messages'));

    this.elScrollbar.addEventListener('mousedown', this.onScrollMouseDown.bind(this));
    this.element.addEventListener('click', this.onClick.bind(this));
    this.element.addEventListener('mousewheel', this.onMouseWheel.bind(this));
  };

  Object.defineProperty(Thread.prototype, 'name', {
    set: function(name) {
      this.$name = name;
      if (name) {
        this.elName.textContent = name;
        this.elName.style.display = 'block';
        this.element.classList.add('named');
      } else {
        this.elName.style.display = 'none';
        this.element.classList.remove('named');
      }
    },
    get: function() {
      return this.$name;
    }
  });

  Object.defineProperty(Thread.prototype, 'prompt', {
    set: function(prompt) {
      if (this.$prompt) {
        this.$prompt.thread = null;
        this.elMessages.removeChild(this.$prompt.element);
      }
      if (this.$prompt = prompt) {
        if (prompt.thread) {
          prompt.thread.prompt = null;
        }
        prompt.thread = this;
        this.elMessages.appendChild(prompt.element);
      }
      this.shouldAutoscroll = true;
      this.contentChanged();
    },
    get: function() {
      return this.$prompt;
    }
  });

  Object.defineProperty(Thread.prototype, 'lastMessage', {
    get: function() {
      return this.messages[this.messages.length - 1];
    }
  });

  Thread.prototype.append = function(message) {
    message.delete();

    this.messages.push(message);
    if (this.prompt) {
      this.elMessages.insertBefore(message.element, this.prompt.element);
    } else {
      this.elMessages.appendChild(message.element);
    }
    message.thread = this;

    this.contentChanged();
  };

  Thread.prototype.delete = function() {
    if (!this.open) return;

    if (this.element.parentNode === app.element) {
      app.element.removeChild(this.element);
    }

    var i = app.threads.indexOf(this);
    if (i !== -1) {
      app.threads.splice(i, 1);
    }
    this.open = true;

    if (this.prompt) {
      this.prompt = null;
      app.activeThread = null;
    }
  };

  Thread.prototype.reply = function(message) {
    this.shouldAutoscroll = true;
    this.append(message);
    socket.emit(message.isChat ? 'chat' : 'system', message.data());
  };

  Object.defineProperty(Thread.prototype, 'id', {
    get: function() {
      return this.name ? '#' + this.name : this.uid ? '!' + this.uid : null;
    }
  });

  Thread.prototype.onMouseWheel = function(e) {
    this.shouldAutoscroll = false;
    this.scroll -= e.wheelDeltaY;
    this.updateScroll();
  };

  Thread.prototype.onClick = function() {
    if (document.getSelection().isCollapsed) {
      app.activeThread = this;
      if (this.prompt) {
        this.prompt.focus();
      }
    }
  };

  Thread.prototype.onScrollMouseMove = function(e) {
    if (!this.dragging) return;
    this.dragScrollbar(e);
  };

  Thread.prototype.onScrollMouseDown = function(e) {
    this.dragging = true;
    this.dragScrollbar(e);
    e.preventDefault();
    document.addEventListener('mousemove', this.onScrollMouseMove);
    document.addEventListener('mouseup', this.onScrollMouseUp);
  };

  Thread.prototype.onScrollMouseUp = function(e) {
    this.dragging = false;
    this.dragScrollbar(e);
    document.removeEventListener('mousemove', this.onScrollMouseMove);
    document.removeEventListener('mouseup', this.onScrollMouseUp);
  };

  Thread.prototype.dragScrollbar = function(e) {
    var scrollbarSize = this.elScrollbar.offsetHeight;
    var viewportSize = this.elContent.offsetHeight;
    var contentSize = Math.max(viewportSize, this.elWrap.offsetHeight);

    var d = (1 - (e.clientY - this.elScrollbar.getBoundingClientRect().top) / scrollbarSize) / Thread.SCROLL_CONSTANT;
    var x = -d / (Thread.SCROLL_CONSTANT * d - 1);
    this.scroll = contentSize - x * viewportSize;
  };

  Thread.prototype.viewportChanged = function() {
    this.viewportSize = this.elContent.offsetHeight;
    this.scrollbarSize = this.elScrollbar.offsetHeight;
    this.rescroll()
  };

  Thread.prototype.contentChanged = function() {
    this.contentSize = this.elWrap.offsetHeight;
    this.rescroll();
  };

  Object.defineProperty(Thread.prototype, 'scroll', {
    set: function(value) {
      if (!this.scrollbarSize) {
        this.$scroll = value
        return;
      }

      this.$scroll = value = Math.max(0, Math.min(value, this.contentSize - this.viewportSize));
      this.updateScroll(true);
    },
    get: function() {
      return this.$scroll;
    }
  });

  Thread.AUTOSCROLL_THRESHOLD = 5;
  Thread.SCROLL_CONSTANT = .1;

  Thread.prototype.rescroll = function() {
    if (this.shouldAutoscroll) {
      this.scroll = this.contentSize - this.viewportSize;
    } else {
      this.updateScroll();
    }
  };

  Thread.prototype.updateScroll = function(property) {
    var max = Math.max(this.contentSize, this.viewportSize);
    if (!property) {
      this.shouldAutoscroll = max - this.viewportSize - this.scroll <= Thread.AUTOSCROLL_THRESHOLD;
    }
    var x = (max - this.scroll) / this.viewportSize;
    var y = (max - (this.scroll + this.viewportSize)) / this.viewportSize;

    var minValue = this.scrollbarSize * (1 - Thread.SCROLL_CONSTANT * x / (Thread.SCROLL_CONSTANT * x + 1));
    var maxValue = this.scrollbarSize * (1 - Thread.SCROLL_CONSTANT * y / (Thread.SCROLL_CONSTANT * y + 1));

    this.elScrollbarHandle.style.top = minValue + 'px';
    this.elScrollbarHandle.style.height = Math.max(1, maxValue - minValue) + 'px';

    this.elWrap.style.top = -this.scroll + 'px';
  };

  var Message = function(data) {
    this.children = [];

    this.template();

    this.time = data.time || new Date;
    if (data.htmlBody) {
      this.html = data.htmlBody
    } else if (data.rawBody) {
      this.html = escapeXML(data.rawBody);
    } else {
      this.body = data.body || '';
    }
  };

  Object.defineProperty(Message.prototype, 'time', {
    set: function(time) {
      this.$time = time;
      this.elTimestamp.textContent = formatTime(time);
    },
    get: function() {
      return this.$time;
    }
  });

  Object.defineProperty(Message.prototype, 'body', {
    set: function(body) {
      this.$body = body;
      this.html = parse(body);
    },
    get: function() {
      return this.$body;
    }
  });

  Object.defineProperty(Message.prototype, 'html', {
    set: function(html) {
      this.$html = html;
      this.elBody.innerHTML = html;
    },
    get: function() {
      return this.$html;
    }
  });

  Message.prototype.data = function() {
    return {
      thread: this.thread.id,
      body: this.body
    };
  };

  Message.prototype.template = function() {
    this.element = el('hoth-message');
    this.element.appendChild(this.elHeader = el('hoth-message-header'));
    this.elHeader.appendChild(this.elTimestamp = el('hoth-message-time'));
    this.element.appendChild(this.elBody = el('hoth-message-body'));
  };

  Message.prototype.delete = function() {
    if (!this.thread) return;

    if (this.element.parentNode === this.thread.elMessages) {
      this.thread.elMessages.removeChild(this.element);
    }

    var i = this.thread.messages.indexOf(this);
    if (i !== -1) {
      this.thread.messages.splice(i, 1);
    }
  };

  var ChatMessage = function(data) {
    this.isChat = true;

    Message.call(this, data);

    if (data.author) this.author = data.author;
  };
  ChatMessage.prototype = Object.create(Message.prototype);

  Object.defineProperty(ChatMessage.prototype, 'author', {
    set: function(author) {
      this.$author = author;
      this.elAuthor.textContent = author.name;
    },
    get: function() {
      return this.$author;
    }
  });

  ChatMessage.prototype.data = function() {
    var json = Message.prototype.data.call(this);
    json.author = this.author.id;
    return json;
  };

  ChatMessage.prototype.template = function() {
    Message.prototype.template.call(this);

    this.element.classList.add('chat');

    this.elHeader.appendChild(this.elAuthor = el('hoth-message-author'));
  };

  var SystemMessage = function(data) {
    Message.call(this, data);
  };
  SystemMessage.prototype = Object.create(Message.prototype);

  SystemMessage.prototype.template = function() {
    Message.prototype.template.call(this);

    this.element.classList.add('system');
  };

  var Prompt = function(data) {
    this.element = el('hoth-message');
    this.element.appendChild(this.elBody = el('hoth-message-body'));

    this.elBody.appendChild(this.elInput = el('hoth-message-input', 'textarea'));
    document.body.appendChild(this.elMeasure = el('hoth-message-measure'));
    this.elMeasure.textContent = 'X';

    this.elInput.placeholder = 'Say something\u2026';
    this.elInput.autofocus = true;
    this.elInput.style.height = this.elMeasure.offsetHeight + 'px';

    this.elInput.addEventListener('input', this.autosize.bind(this));

    this.elInput.addEventListener('keydown', this.onKeyDown.bind(this));
  };

  Prompt.prototype.onKeyDown = function(e) {
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.keyCode === 13) {
      if (this.elInput.value) {
        this.send(this.elInput.value);
      }
      this.elInput.value = '';
      this.autosize();
      e.preventDefault();
    }
  };

  Prompt.prototype.autosize = function() {
    this.elMeasure.textContent = this.elInput.value + 'X';
    var height = this.elMeasure.offsetHeight;
    if (this.height !== height) {
      this.height = height;
      this.elInput.style.height = height + 'px';
      if (this.thread) {
        this.thread.contentChanged();
      }
    }
  };

  Prompt.prototype.send = function(value) {
    if (value[0] === '/') {
      this.sendCommand(value.substr(1));
    } else {
      this.sendMessage(value);
    }
  };

  Prompt.prototype.sendMessage = function(value) {
    var x = RE_HASHTAG.exec(value);
    if (x) {
      value = value.slice(x[0].length).trim();
      app.activeThread = x[2] ? Thread.topic(x[2]) : Thread.temp(x[3]);
      if (!value) return;
    }
    var message = new ChatMessage({
      author: currentUser,
      body: value
    });
    this.thread.reply(message);
  };

  Prompt.prototype.sendCommand = function(command) {
    this.thread.append(new SystemMessage({
      body: 'Commands are not implemented.'
    }));
  };

  Prompt.prototype.focus = function() {
    this.elInput.focus();
  };

  var User = function(data) {
    this.name = data.name;
    this.id = data.id;
  };
  User.map = {};

  User.get = function(id, callback) {
    if (User.map[id]) {
      callback(User.map[id]);
      return;
    }
    socket.emit('user', id, function(data) {
      callback(User.map[id] = new User(data));
    });
  };

  var currentUser;

  var app = {};

  app.init = function() {
    this.threads = [];
    this.topics = {};

    this.element = el('hoth-app');
    document.body.appendChild(this.element);

    this.lobby = Thread.topic('lobby');
    this.append(this.lobby);

    this.prompt = new Prompt;
    this.activeThread = this.lobby;

    document.body.addEventListener('keydown', this.onKeyDown.bind(this));
    window.addEventListener('resize', this.layout.bind(this));
    window.addEventListener('hashchange', this.onHashChange.bind(this));
  };

  Object.defineProperty(app, 'prompt', {
    set: function(prompt) {
      if (this.$prompt) {
        this.$prompt.delete();
      }
      this.$prompt = prompt;
      if (this.activeThread) {
        this.activeThread.prompt = prompt;
      }
    },
    get: function() {
      return this.$prompt;
    }
  });

  app.thread = Thread.get;
  app.topic = Thread.topic;

  Object.defineProperty(app, 'activeThread', {
    set: function(thread) {
      if (this.$activeThread === thread) return;

      if (!thread.open) {
        this.append(thread);
      }
      if (this.$activeThread = thread) {
        if (thread.name) {
          location.hash = '#' + thread.name;
        }
        thread.element.scrollIntoView();
        if (this.prompt) {
          thread.prompt = this.prompt;
          setTimeout(function() {
            this.prompt.focus();
          }.bind(this));
        }
      }
    },
    get: function() {
      return this.$activeThread;
    }
  });

  app.append = function(thread) {
    if (thread.open) return;
    this.threads.push(thread);
    this.element.appendChild(thread.element);
    thread.open = true;
    thread.viewportChanged();
  };

  app.layout = function() {
    this.threads.forEach(function(thread) {
      thread.viewportChanged();
    });
  };

  app.reply = function(message) {
    this.activeThread.reply(message);
  };

  app.onKeyDown = function(e) {
    var modifiers =
      (e.ctrlKey ? 'c' : '') +
      (e.altKey ? 'a' : '') +
      (e.shiftKey ? 's' : '') +
      (e.metaKey ? 'm' : '');
  };

  app.onHashChange = function() {
    var hash = location.hash;
    if (hash.length <= 1) return;
    if (hash[1] === '{') {
      try {
        this.runHash(JSON.parse(hash.slice(1)));
      } catch (e) {}
      return;
    }
    this.activeThread = Thread.topic(hash.slice(1));
  };

  app.runHash = function(json) {
    if (json.goto) {
      Thread.get(json.goto, function(thread) {
        app.activeThread = thread;
      });
    }
  };

  Object.defineProperty(app, 'currentUser', {
    get: function () {
      return currentUser;
    }
  });

  var socket = io.connect(location.protocol + '//' + location.host);

  socket.on('system', function(data) {
    Thread.get(data.thread, function(thread) {
      if (thread && data.body) {
        thread.append(new SystemMessage({ body: data.body }));
      }
    });
  }.bind(this));

  socket.on('chat', function(data) {
    User.get(data.author, function(user) {
      Thread.get(data.thread, function(thread) {
        thread.append(new ChatMessage({
          author: user,
          body: data.body
        }));
      });
    });
  });

  socket.on('open thread', function(name) {
    Thread.get(name, function(thread) {
      app.append(thread);
    });
  });

  socket.on('init', function(data) {
    currentUser = new User(data.user);
    Hoth.init();
  });

  app.User = User;
  app.Thread = Thread;
  app.ChatMessage = ChatMessage;
  app.SystemMessage = SystemMessage;
  app.Message = Message;

  return app;

}());
