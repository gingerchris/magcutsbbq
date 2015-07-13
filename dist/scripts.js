/*!
 *  Copyright 2011 Twitter, Inc.
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */



var Hogan = {};

(function (Hogan) {
  Hogan.Template = function (codeObj, text, compiler, options) {
    codeObj = codeObj || {};
    this.r = codeObj.code || this.r;
    this.c = compiler;
    this.options = options || {};
    this.text = text || '';
    this.partials = codeObj.partials || {};
    this.subs = codeObj.subs || {};
    this.buf = '';
  }

  Hogan.Template.prototype = {
    // render: replaced by generated code.
    r: function (context, partials, indent) { return ''; },

    // variable escaping
    v: hoganEscape,

    // triple stache
    t: coerceToString,

    render: function render(context, partials, indent) {
      return this.ri([context], partials || {}, indent);
    },

    // render internal -- a hook for overrides that catches partials too
    ri: function (context, partials, indent) {
      return this.r(context, partials, indent);
    },

    // ensurePartial
    ep: function(symbol, partials) {
      var partial = this.partials[symbol];

      // check to see that if we've instantiated this partial before
      var template = partials[partial.name];
      if (partial.instance && partial.base == template) {
        return partial.instance;
      }

      if (typeof template == 'string') {
        if (!this.c) {
          throw new Error("No compiler available.");
        }
        template = this.c.compile(template, this.options);
      }

      if (!template) {
        return null;
      }

      // We use this to check whether the partials dictionary has changed
      this.partials[symbol].base = template;

      if (partial.subs) {
        // Make sure we consider parent template now
        if (!partials.stackText) partials.stackText = {};
        for (key in partial.subs) {
          if (!partials.stackText[key]) {
            partials.stackText[key] = (this.activeSub !== undefined && partials.stackText[this.activeSub]) ? partials.stackText[this.activeSub] : this.text;
          }
        }
        template = createSpecializedPartial(template, partial.subs, partial.partials,
          this.stackSubs, this.stackPartials, partials.stackText);
      }
      this.partials[symbol].instance = template;

      return template;
    },

    // tries to find a partial in the current scope and render it
    rp: function(symbol, context, partials, indent) {
      var partial = this.ep(symbol, partials);
      if (!partial) {
        return '';
      }

      return partial.ri(context, partials, indent);
    },

    // render a section
    rs: function(context, partials, section) {
      var tail = context[context.length - 1];

      if (!isArray(tail)) {
        section(context, partials, this);
        return;
      }

      for (var i = 0; i < tail.length; i++) {
        context.push(tail[i]);
        section(context, partials, this);
        context.pop();
      }
    },

    // maybe start a section
    s: function(val, ctx, partials, inverted, start, end, tags) {
      var pass;

      if (isArray(val) && val.length === 0) {
        return false;
      }

      if (typeof val == 'function') {
        val = this.ms(val, ctx, partials, inverted, start, end, tags);
      }

      pass = !!val;

      if (!inverted && pass && ctx) {
        ctx.push((typeof val == 'object') ? val : ctx[ctx.length - 1]);
      }

      return pass;
    },

    // find values with dotted names
    d: function(key, ctx, partials, returnFound) {
      var found,
          names = key.split('.'),
          val = this.f(names[0], ctx, partials, returnFound),
          doModelGet = this.options.modelGet,
          cx = null;

      if (key === '.' && isArray(ctx[ctx.length - 2])) {
        val = ctx[ctx.length - 1];
      } else {
        for (var i = 1; i < names.length; i++) {
          found = findInScope(names[i], val, doModelGet);
          if (found !== undefined) {
            cx = val;
            val = found;
          } else {
            val = '';
          }
        }
      }

      if (returnFound && !val) {
        return false;
      }

      if (!returnFound && typeof val == 'function') {
        ctx.push(cx);
        val = this.mv(val, ctx, partials);
        ctx.pop();
      }

      return val;
    },

    // find values with normal names
    f: function(key, ctx, partials, returnFound) {
      var val = false,
          v = null,
          found = false,
          doModelGet = this.options.modelGet;

      for (var i = ctx.length - 1; i >= 0; i--) {
        v = ctx[i];
        val = findInScope(key, v, doModelGet);
        if (val !== undefined) {
          found = true;
          break;
        }
      }

      if (!found) {
        return (returnFound) ? false : "";
      }

      if (!returnFound && typeof val == 'function') {
        val = this.mv(val, ctx, partials);
      }

      return val;
    },

    // higher order templates
    ls: function(func, cx, partials, text, tags) {
      var oldTags = this.options.delimiters;

      this.options.delimiters = tags;
      this.b(this.ct(coerceToString(func.call(cx, text)), cx, partials));
      this.options.delimiters = oldTags;

      return false;
    },

    // compile text
    ct: function(text, cx, partials) {
      if (this.options.disableLambda) {
        throw new Error('Lambda features disabled.');
      }
      return this.c.compile(text, this.options).render(cx, partials);
    },

    // template result buffering
    b: function(s) { this.buf += s; },

    fl: function() { var r = this.buf; this.buf = ''; return r; },

    // method replace section
    ms: function(func, ctx, partials, inverted, start, end, tags) {
      var textSource,
          cx = ctx[ctx.length - 1],
          result = func.call(cx);

      if (typeof result == 'function') {
        if (inverted) {
          return true;
        } else {
          textSource = (this.activeSub && this.subsText && this.subsText[this.activeSub]) ? this.subsText[this.activeSub] : this.text;
          return this.ls(result, cx, partials, textSource.substring(start, end), tags);
        }
      }

      return result;
    },

    // method replace variable
    mv: function(func, ctx, partials) {
      var cx = ctx[ctx.length - 1];
      var result = func.call(cx);

      if (typeof result == 'function') {
        return this.ct(coerceToString(result.call(cx)), cx, partials);
      }

      return result;
    },

    sub: function(name, context, partials, indent) {
      var f = this.subs[name];
      if (f) {
        this.activeSub = name;
        f(context, partials, this, indent);
        this.activeSub = false;
      }
    }

  };

  //Find a key in an object
  function findInScope(key, scope, doModelGet) {
    var val;

    if (scope && typeof scope == 'object') {

      if (scope[key] !== undefined) {
        val = scope[key];

      // try lookup with get for backbone or similar model data
      } else if (doModelGet && scope.get && typeof scope.get == 'function') {
        val = scope.get(key);
      }
    }

    return val;
  }

  function createSpecializedPartial(instance, subs, partials, stackSubs, stackPartials, stackText) {
    function PartialTemplate() {};
    PartialTemplate.prototype = instance;
    function Substitutions() {};
    Substitutions.prototype = instance.subs;
    var key;
    var partial = new PartialTemplate();
    partial.subs = new Substitutions();
    partial.subsText = {};  //hehe. substext.
    partial.buf = '';

    stackSubs = stackSubs || {};
    partial.stackSubs = stackSubs;
    partial.subsText = stackText;
    for (key in subs) {
      if (!stackSubs[key]) stackSubs[key] = subs[key];
    }
    for (key in stackSubs) {
      partial.subs[key] = stackSubs[key];
    }

    stackPartials = stackPartials || {};
    partial.stackPartials = stackPartials;
    for (key in partials) {
      if (!stackPartials[key]) stackPartials[key] = partials[key];
    }
    for (key in stackPartials) {
      partial.partials[key] = stackPartials[key];
    }

    return partial;
  }

  var rAmp = /&/g,
      rLt = /</g,
      rGt = />/g,
      rApos = /\'/g,
      rQuot = /\"/g,
      hChars = /[&<>\"\']/;

  function coerceToString(val) {
    return String((val === null || val === undefined) ? '' : val);
  }

  function hoganEscape(str) {
    str = coerceToString(str);
    return hChars.test(str) ?
      str
        .replace(rAmp, '&amp;')
        .replace(rLt, '&lt;')
        .replace(rGt, '&gt;')
        .replace(rApos, '&#39;')
        .replace(rQuot, '&quot;') :
      str;
  }

  var isArray = Array.isArray || function(a) {
    return Object.prototype.toString.call(a) === '[object Array]';
  };

})(typeof exports !== 'undefined' ? exports : Hogan);



(function (Hogan) {
  // Setup regex  assignments
  // remove whitespace according to Mustache spec
  var rIsWhitespace = /\S/,
      rQuot = /\"/g,
      rNewline =  /\n/g,
      rCr = /\r/g,
      rSlash = /\\/g,
      rLineSep = /\u2028/,
      rParagraphSep = /\u2029/;

  Hogan.tags = {
    '#': 1, '^': 2, '<': 3, '$': 4,
    '/': 5, '!': 6, '>': 7, '=': 8, '_v': 9,
    '{': 10, '&': 11, '_t': 12
  };

  Hogan.scan = function scan(text, delimiters) {
    var len = text.length,
        IN_TEXT = 0,
        IN_TAG_TYPE = 1,
        IN_TAG = 2,
        state = IN_TEXT,
        tagType = null,
        tag = null,
        buf = '',
        tokens = [],
        seenTag = false,
        i = 0,
        lineStart = 0,
        otag = '{{',
        ctag = '}}';

    function addBuf() {
      if (buf.length > 0) {
        tokens.push({tag: '_t', text: new String(buf)});
        buf = '';
      }
    }

    function lineIsWhitespace() {
      var isAllWhitespace = true;
      for (var j = lineStart; j < tokens.length; j++) {
        isAllWhitespace =
          (Hogan.tags[tokens[j].tag] < Hogan.tags['_v']) ||
          (tokens[j].tag == '_t' && tokens[j].text.match(rIsWhitespace) === null);
        if (!isAllWhitespace) {
          return false;
        }
      }

      return isAllWhitespace;
    }

    function filterLine(haveSeenTag, noNewLine) {
      addBuf();

      if (haveSeenTag && lineIsWhitespace()) {
        for (var j = lineStart, next; j < tokens.length; j++) {
          if (tokens[j].text) {
            if ((next = tokens[j+1]) && next.tag == '>') {
              // set indent to token value
              next.indent = tokens[j].text.toString()
            }
            tokens.splice(j, 1);
          }
        }
      } else if (!noNewLine) {
        tokens.push({tag:'\n'});
      }

      seenTag = false;
      lineStart = tokens.length;
    }

    function changeDelimiters(text, index) {
      var close = '=' + ctag,
          closeIndex = text.indexOf(close, index),
          delimiters = trim(
            text.substring(text.indexOf('=', index) + 1, closeIndex)
          ).split(' ');

      otag = delimiters[0];
      ctag = delimiters[delimiters.length - 1];

      return closeIndex + close.length - 1;
    }

    if (delimiters) {
      delimiters = delimiters.split(' ');
      otag = delimiters[0];
      ctag = delimiters[1];
    }

    for (i = 0; i < len; i++) {
      if (state == IN_TEXT) {
        if (tagChange(otag, text, i)) {
          --i;
          addBuf();
          state = IN_TAG_TYPE;
        } else {
          if (text.charAt(i) == '\n') {
            filterLine(seenTag);
          } else {
            buf += text.charAt(i);
          }
        }
      } else if (state == IN_TAG_TYPE) {
        i += otag.length - 1;
        tag = Hogan.tags[text.charAt(i + 1)];
        tagType = tag ? text.charAt(i + 1) : '_v';
        if (tagType == '=') {
          i = changeDelimiters(text, i);
          state = IN_TEXT;
        } else {
          if (tag) {
            i++;
          }
          state = IN_TAG;
        }
        seenTag = i;
      } else {
        if (tagChange(ctag, text, i)) {
          tokens.push({tag: tagType, n: trim(buf), otag: otag, ctag: ctag,
                       i: (tagType == '/') ? seenTag - otag.length : i + ctag.length});
          buf = '';
          i += ctag.length - 1;
          state = IN_TEXT;
          if (tagType == '{') {
            if (ctag == '}}') {
              i++;
            } else {
              cleanTripleStache(tokens[tokens.length - 1]);
            }
          }
        } else {
          buf += text.charAt(i);
        }
      }
    }

    filterLine(seenTag, true);

    return tokens;
  }

  function cleanTripleStache(token) {
    if (token.n.substr(token.n.length - 1) === '}') {
      token.n = token.n.substring(0, token.n.length - 1);
    }
  }

  function trim(s) {
    if (s.trim) {
      return s.trim();
    }

    return s.replace(/^\s*|\s*$/g, '');
  }

  function tagChange(tag, text, index) {
    if (text.charAt(index) != tag.charAt(0)) {
      return false;
    }

    for (var i = 1, l = tag.length; i < l; i++) {
      if (text.charAt(index + i) != tag.charAt(i)) {
        return false;
      }
    }

    return true;
  }

  // the tags allowed inside super templates
  var allowedInSuper = {'_t': true, '\n': true, '$': true, '/': true};

  function buildTree(tokens, kind, stack, customTags) {
    var instructions = [],
        opener = null,
        tail = null,
        token = null;

    tail = stack[stack.length - 1];

    while (tokens.length > 0) {
      token = tokens.shift();

      if (tail && tail.tag == '<' && !(token.tag in allowedInSuper)) {
        throw new Error('Illegal content in < super tag.');
      }

      if (Hogan.tags[token.tag] <= Hogan.tags['$'] || isOpener(token, customTags)) {
        stack.push(token);
        token.nodes = buildTree(tokens, token.tag, stack, customTags);
      } else if (token.tag == '/') {
        if (stack.length === 0) {
          throw new Error('Closing tag without opener: /' + token.n);
        }
        opener = stack.pop();
        if (token.n != opener.n && !isCloser(token.n, opener.n, customTags)) {
          throw new Error('Nesting error: ' + opener.n + ' vs. ' + token.n);
        }
        opener.end = token.i;
        return instructions;
      } else if (token.tag == '\n') {
        token.last = (tokens.length == 0) || (tokens[0].tag == '\n');
      }

      instructions.push(token);
    }

    if (stack.length > 0) {
      throw new Error('missing closing tag: ' + stack.pop().n);
    }

    return instructions;
  }

  function isOpener(token, tags) {
    for (var i = 0, l = tags.length; i < l; i++) {
      if (tags[i].o == token.n) {
        token.tag = '#';
        return true;
      }
    }
  }

  function isCloser(close, open, tags) {
    for (var i = 0, l = tags.length; i < l; i++) {
      if (tags[i].c == close && tags[i].o == open) {
        return true;
      }
    }
  }

  function stringifySubstitutions(obj) {
    var items = [];
    for (var key in obj) {
      items.push('"' + esc(key) + '": function(c,p,t,i) {' + obj[key] + '}');
    }
    return "{ " + items.join(",") + " }";
  }

  function stringifyPartials(codeObj) {
    var partials = [];
    for (var key in codeObj.partials) {
      partials.push('"' + esc(key) + '":{name:"' + esc(codeObj.partials[key].name) + '", ' + stringifyPartials(codeObj.partials[key]) + "}");
    }
    return "partials: {" + partials.join(",") + "}, subs: " + stringifySubstitutions(codeObj.subs);
  }

  Hogan.stringify = function(codeObj, text, options) {
    return "{code: function (c,p,i) { " + Hogan.wrapMain(codeObj.code) + " }," + stringifyPartials(codeObj) +  "}";
  }

  var serialNo = 0;
  Hogan.generate = function(tree, text, options) {
    serialNo = 0;
    var context = { code: '', subs: {}, partials: {} };
    Hogan.walk(tree, context);

    if (options.asString) {
      return this.stringify(context, text, options);
    }

    return this.makeTemplate(context, text, options);
  }

  Hogan.wrapMain = function(code) {
    return 'var t=this;t.b(i=i||"");' + code + 'return t.fl();';
  }

  Hogan.template = Hogan.Template;

  Hogan.makeTemplate = function(codeObj, text, options) {
    var template = this.makePartials(codeObj);
    template.code = new Function('c', 'p', 'i', this.wrapMain(codeObj.code));
    return new this.template(template, text, this, options);
  }

  Hogan.makePartials = function(codeObj) {
    var key, template = {subs: {}, partials: codeObj.partials, name: codeObj.name};
    for (key in template.partials) {
      template.partials[key] = this.makePartials(template.partials[key]);
    }
    for (key in codeObj.subs) {
      template.subs[key] = new Function('c', 'p', 't', 'i', codeObj.subs[key]);
    }
    return template;
  }

  function esc(s) {
    return s.replace(rSlash, '\\\\')
            .replace(rQuot, '\\\"')
            .replace(rNewline, '\\n')
            .replace(rCr, '\\r')
            .replace(rLineSep, '\\u2028')
            .replace(rParagraphSep, '\\u2029');
  }

  function chooseMethod(s) {
    return (~s.indexOf('.')) ? 'd' : 'f';
  }

  function createPartial(node, context) {
    var prefix = "<" + (context.prefix || "");
    var sym = prefix + node.n + serialNo++;
    context.partials[sym] = {name: node.n, partials: {}};
    context.code += 't.b(t.rp("' +  esc(sym) + '",c,p,"' + (node.indent || '') + '"));';
    return sym;
  }

  Hogan.codegen = {
    '#': function(node, context) {
      context.code += 'if(t.s(t.' + chooseMethod(node.n) + '("' + esc(node.n) + '",c,p,1),' +
                      'c,p,0,' + node.i + ',' + node.end + ',"' + node.otag + " " + node.ctag + '")){' +
                      't.rs(c,p,' + 'function(c,p,t){';
      Hogan.walk(node.nodes, context);
      context.code += '});c.pop();}';
    },

    '^': function(node, context) {
      context.code += 'if(!t.s(t.' + chooseMethod(node.n) + '("' + esc(node.n) + '",c,p,1),c,p,1,0,0,"")){';
      Hogan.walk(node.nodes, context);
      context.code += '};';
    },

    '>': createPartial,
    '<': function(node, context) {
      var ctx = {partials: {}, code: '', subs: {}, inPartial: true};
      Hogan.walk(node.nodes, ctx);
      var template = context.partials[createPartial(node, context)];
      template.subs = ctx.subs;
      template.partials = ctx.partials;
    },

    '$': function(node, context) {
      var ctx = {subs: {}, code: '', partials: context.partials, prefix: node.n};
      Hogan.walk(node.nodes, ctx);
      context.subs[node.n] = ctx.code;
      if (!context.inPartial) {
        context.code += 't.sub("' + esc(node.n) + '",c,p,i);';
      }
    },

    '\n': function(node, context) {
      context.code += write('"\\n"' + (node.last ? '' : ' + i'));
    },

    '_v': function(node, context) {
      context.code += 't.b(t.v(t.' + chooseMethod(node.n) + '("' + esc(node.n) + '",c,p,0)));';
    },

    '_t': function(node, context) {
      context.code += write('"' + esc(node.text) + '"');
    },

    '{': tripleStache,

    '&': tripleStache
  }

  function tripleStache(node, context) {
    context.code += 't.b(t.t(t.' + chooseMethod(node.n) + '("' + esc(node.n) + '",c,p,0)));';
  }

  function write(s) {
    return 't.b(' + s + ');';
  }

  Hogan.walk = function(nodelist, context) {
    var func;
    for (var i = 0, l = nodelist.length; i < l; i++) {
      func = Hogan.codegen[nodelist[i].tag];
      func && func(nodelist[i], context);
    }
    return context;
  }

  Hogan.parse = function(tokens, text, options) {
    options = options || {};
    return buildTree(tokens, '', [], options.sectionTags || []);
  }

  Hogan.cache = {};

  Hogan.cacheKey = function(text, options) {
    return [text, !!options.asString, !!options.disableLambda, options.delimiters, !!options.modelGet].join('||');
  }

  Hogan.compile = function(text, options) {
    options = options || {};
    var key = Hogan.cacheKey(text, options);
    var template = this.cache[key];

    if (template) {
      var partials = template.partials;
      for (var name in partials) {
        delete partials[name].instance;
      }
      return template;
    }

    template = this.generate(this.parse(this.scan(text, options.delimiters), text, options), text, options);
    return this.cache[key] = template;
  }
})(typeof exports !== 'undefined' ? exports : Hogan);


if (!!!templates) var templates = {};
templates["item"] = new Hogan.Template({code: function (c,p,i) { var t=this;t.b(i=i||"");t.b("<div class=\"insta_item\">");t.b("\n" + i);t.b("	<a href=\"");t.b(t.v(t.f("link",c,p,0)));t.b("\" target=\"_blank\">");t.b("\n" + i);if(!t.s(t.f("videos",c,p,1),c,p,1,0,0,"")){t.b("			<img src=\"");t.b(t.v(t.d("images.low_resolution.url",c,p,0)));t.b("\" alt=\"");t.b(t.v(t.d("caption.text",c,p,0)));t.b("\" />");t.b("\n" + i);};if(t.s(t.f("videos",c,p,1),c,p,0,173,279,"{{ }}")){t.rs(c,p,function(c,p,t){t.b("			<video autoplay loop>");t.b("\n" + i);t.b("				<source src=\"");t.b(t.v(t.d("videos.low_resolution.url",c,p,0)));t.b("\" type=\"video/mp4\">");t.b("\n" + i);t.b("			</video>");t.b("\n" + i);});c.pop();}if(t.s(t.d("caption.text",c,p,1),c,p,0,310,381,"{{ }}")){t.rs(c,p,function(c,p,t){t.b("			<div class=\"insta_item__caption\">");t.b("\n" + i);t.b("				");t.b(t.v(t.d("caption.text",c,p,0)));t.b("\n" + i);t.b("			</div>");t.b("\n" + i);});c.pop();}if(t.s(t.d("location.name",c,p,1),c,p,0,419,492,"{{ }}")){t.rs(c,p,function(c,p,t){t.b("			<div class=\"insta_item__location\">");t.b("\n" + i);t.b("				");t.b(t.v(t.d("location.name",c,p,0)));t.b("\n" + i);t.b("			</div>");t.b("\n" + i);});c.pop();}t.b("		<img class=\"overlay\" src=\"magnificent_cuts.gif\" />");t.b("\n" + i);t.b("	</a>");t.b("\n" + i);t.b("</div>");return t.fl(); },partials: {}, subs: {  }});
templates["item"] = new Hogan.Template({code: function (c,p,i) { var t=this;t.b(i=i||"");t.b("<div class=\"insta_item\">");t.b("\n" + i);t.b("	<a href=\"");t.b(t.v(t.f("link",c,p,0)));t.b("\" target=\"_blank\">");t.b("\n" + i);if(!t.s(t.f("videos",c,p,1),c,p,1,0,0,"")){t.b("			<img src=\"");t.b(t.v(t.d("images.low_resolution.url",c,p,0)));t.b("\" alt=\"");t.b(t.v(t.d("caption.text",c,p,0)));t.b("\" />");t.b("\n" + i);};if(t.s(t.f("videos",c,p,1),c,p,0,173,279,"{{ }}")){t.rs(c,p,function(c,p,t){t.b("			<video autoplay loop>");t.b("\n" + i);t.b("				<source src=\"");t.b(t.v(t.d("videos.low_resolution.url",c,p,0)));t.b("\" type=\"video/mp4\">");t.b("\n" + i);t.b("			</video>");t.b("\n" + i);});c.pop();}if(t.s(t.d("caption.text",c,p,1),c,p,0,310,381,"{{ }}")){t.rs(c,p,function(c,p,t){t.b("			<div class=\"insta_item__caption\">");t.b("\n" + i);t.b("				");t.b(t.v(t.d("caption.text",c,p,0)));t.b("\n" + i);t.b("			</div>");t.b("\n" + i);});c.pop();}if(t.s(t.d("location.name",c,p,1),c,p,0,419,492,"{{ }}")){t.rs(c,p,function(c,p,t){t.b("			<div class=\"insta_item__location\">");t.b("\n" + i);t.b("				");t.b(t.v(t.d("location.name",c,p,0)));t.b("\n" + i);t.b("			</div>");t.b("\n" + i);});c.pop();}t.b("		<img class=\"overlay\" src=\"magnificent_cuts.gif\" />");t.b("\n" + i);t.b("	</a>");t.b("\n" + i);t.b("</div>");return t.fl(); },partials: {}, subs: {  }});

var clientId = '7304c4d57e6f42ed85f01d60fda52a2b';
var accessToken = '2049417506.7304c4d.8f36d0fc98bc4f688e7a17fec4d728bc';

$(function(){
	var gallery = $('#gallery');
  get().done(function(resp){
  	$.each(resp.data,function(){
  		gallery.append(templates.item.render(this));
  	})
  	$("video").prop("volume", 0);
  });
})

var get = function(){
	return $.ajax({
		type: "GET",
        dataType: "jsonp",
        url : 'https://api.instagram.com/v1/users/self/media/recent?access_token=2049417506.1fb234f.5325325fc24f468f8a8621c1a39a5ce0&count=30'
	})
}


//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImhvZ2FuLTMuMC4yLmpzIiwidGVtcGxhdGVzLmpzIiwiaW5zdGFncmFtLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQ252QkE7QUFDQTtBQUNBO0FBQ0E7QUNIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJzY3JpcHRzLmpzIiwic291cmNlc0NvbnRlbnQiOlsiLyohXG4gKiAgQ29weXJpZ2h0IDIwMTEgVHdpdHRlciwgSW5jLlxuICogIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gKiAgeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuICogIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiAgVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxuICogIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqICBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqICBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXG4gKiAgbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKi9cblxuXG5cbnZhciBIb2dhbiA9IHt9O1xuXG4oZnVuY3Rpb24gKEhvZ2FuKSB7XG4gIEhvZ2FuLlRlbXBsYXRlID0gZnVuY3Rpb24gKGNvZGVPYmosIHRleHQsIGNvbXBpbGVyLCBvcHRpb25zKSB7XG4gICAgY29kZU9iaiA9IGNvZGVPYmogfHwge307XG4gICAgdGhpcy5yID0gY29kZU9iai5jb2RlIHx8IHRoaXMucjtcbiAgICB0aGlzLmMgPSBjb21waWxlcjtcbiAgICB0aGlzLm9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuICAgIHRoaXMudGV4dCA9IHRleHQgfHwgJyc7XG4gICAgdGhpcy5wYXJ0aWFscyA9IGNvZGVPYmoucGFydGlhbHMgfHwge307XG4gICAgdGhpcy5zdWJzID0gY29kZU9iai5zdWJzIHx8IHt9O1xuICAgIHRoaXMuYnVmID0gJyc7XG4gIH1cblxuICBIb2dhbi5UZW1wbGF0ZS5wcm90b3R5cGUgPSB7XG4gICAgLy8gcmVuZGVyOiByZXBsYWNlZCBieSBnZW5lcmF0ZWQgY29kZS5cbiAgICByOiBmdW5jdGlvbiAoY29udGV4dCwgcGFydGlhbHMsIGluZGVudCkgeyByZXR1cm4gJyc7IH0sXG5cbiAgICAvLyB2YXJpYWJsZSBlc2NhcGluZ1xuICAgIHY6IGhvZ2FuRXNjYXBlLFxuXG4gICAgLy8gdHJpcGxlIHN0YWNoZVxuICAgIHQ6IGNvZXJjZVRvU3RyaW5nLFxuXG4gICAgcmVuZGVyOiBmdW5jdGlvbiByZW5kZXIoY29udGV4dCwgcGFydGlhbHMsIGluZGVudCkge1xuICAgICAgcmV0dXJuIHRoaXMucmkoW2NvbnRleHRdLCBwYXJ0aWFscyB8fCB7fSwgaW5kZW50KTtcbiAgICB9LFxuXG4gICAgLy8gcmVuZGVyIGludGVybmFsIC0tIGEgaG9vayBmb3Igb3ZlcnJpZGVzIHRoYXQgY2F0Y2hlcyBwYXJ0aWFscyB0b29cbiAgICByaTogZnVuY3Rpb24gKGNvbnRleHQsIHBhcnRpYWxzLCBpbmRlbnQpIHtcbiAgICAgIHJldHVybiB0aGlzLnIoY29udGV4dCwgcGFydGlhbHMsIGluZGVudCk7XG4gICAgfSxcblxuICAgIC8vIGVuc3VyZVBhcnRpYWxcbiAgICBlcDogZnVuY3Rpb24oc3ltYm9sLCBwYXJ0aWFscykge1xuICAgICAgdmFyIHBhcnRpYWwgPSB0aGlzLnBhcnRpYWxzW3N5bWJvbF07XG5cbiAgICAgIC8vIGNoZWNrIHRvIHNlZSB0aGF0IGlmIHdlJ3ZlIGluc3RhbnRpYXRlZCB0aGlzIHBhcnRpYWwgYmVmb3JlXG4gICAgICB2YXIgdGVtcGxhdGUgPSBwYXJ0aWFsc1twYXJ0aWFsLm5hbWVdO1xuICAgICAgaWYgKHBhcnRpYWwuaW5zdGFuY2UgJiYgcGFydGlhbC5iYXNlID09IHRlbXBsYXRlKSB7XG4gICAgICAgIHJldHVybiBwYXJ0aWFsLmluc3RhbmNlO1xuICAgICAgfVxuXG4gICAgICBpZiAodHlwZW9mIHRlbXBsYXRlID09ICdzdHJpbmcnKSB7XG4gICAgICAgIGlmICghdGhpcy5jKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29tcGlsZXIgYXZhaWxhYmxlLlwiKTtcbiAgICAgICAgfVxuICAgICAgICB0ZW1wbGF0ZSA9IHRoaXMuYy5jb21waWxlKHRlbXBsYXRlLCB0aGlzLm9wdGlvbnMpO1xuICAgICAgfVxuXG4gICAgICBpZiAoIXRlbXBsYXRlKSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuXG4gICAgICAvLyBXZSB1c2UgdGhpcyB0byBjaGVjayB3aGV0aGVyIHRoZSBwYXJ0aWFscyBkaWN0aW9uYXJ5IGhhcyBjaGFuZ2VkXG4gICAgICB0aGlzLnBhcnRpYWxzW3N5bWJvbF0uYmFzZSA9IHRlbXBsYXRlO1xuXG4gICAgICBpZiAocGFydGlhbC5zdWJzKSB7XG4gICAgICAgIC8vIE1ha2Ugc3VyZSB3ZSBjb25zaWRlciBwYXJlbnQgdGVtcGxhdGUgbm93XG4gICAgICAgIGlmICghcGFydGlhbHMuc3RhY2tUZXh0KSBwYXJ0aWFscy5zdGFja1RleHQgPSB7fTtcbiAgICAgICAgZm9yIChrZXkgaW4gcGFydGlhbC5zdWJzKSB7XG4gICAgICAgICAgaWYgKCFwYXJ0aWFscy5zdGFja1RleHRba2V5XSkge1xuICAgICAgICAgICAgcGFydGlhbHMuc3RhY2tUZXh0W2tleV0gPSAodGhpcy5hY3RpdmVTdWIgIT09IHVuZGVmaW5lZCAmJiBwYXJ0aWFscy5zdGFja1RleHRbdGhpcy5hY3RpdmVTdWJdKSA/IHBhcnRpYWxzLnN0YWNrVGV4dFt0aGlzLmFjdGl2ZVN1Yl0gOiB0aGlzLnRleHQ7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHRlbXBsYXRlID0gY3JlYXRlU3BlY2lhbGl6ZWRQYXJ0aWFsKHRlbXBsYXRlLCBwYXJ0aWFsLnN1YnMsIHBhcnRpYWwucGFydGlhbHMsXG4gICAgICAgICAgdGhpcy5zdGFja1N1YnMsIHRoaXMuc3RhY2tQYXJ0aWFscywgcGFydGlhbHMuc3RhY2tUZXh0KTtcbiAgICAgIH1cbiAgICAgIHRoaXMucGFydGlhbHNbc3ltYm9sXS5pbnN0YW5jZSA9IHRlbXBsYXRlO1xuXG4gICAgICByZXR1cm4gdGVtcGxhdGU7XG4gICAgfSxcblxuICAgIC8vIHRyaWVzIHRvIGZpbmQgYSBwYXJ0aWFsIGluIHRoZSBjdXJyZW50IHNjb3BlIGFuZCByZW5kZXIgaXRcbiAgICBycDogZnVuY3Rpb24oc3ltYm9sLCBjb250ZXh0LCBwYXJ0aWFscywgaW5kZW50KSB7XG4gICAgICB2YXIgcGFydGlhbCA9IHRoaXMuZXAoc3ltYm9sLCBwYXJ0aWFscyk7XG4gICAgICBpZiAoIXBhcnRpYWwpIHtcbiAgICAgICAgcmV0dXJuICcnO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcGFydGlhbC5yaShjb250ZXh0LCBwYXJ0aWFscywgaW5kZW50KTtcbiAgICB9LFxuXG4gICAgLy8gcmVuZGVyIGEgc2VjdGlvblxuICAgIHJzOiBmdW5jdGlvbihjb250ZXh0LCBwYXJ0aWFscywgc2VjdGlvbikge1xuICAgICAgdmFyIHRhaWwgPSBjb250ZXh0W2NvbnRleHQubGVuZ3RoIC0gMV07XG5cbiAgICAgIGlmICghaXNBcnJheSh0YWlsKSkge1xuICAgICAgICBzZWN0aW9uKGNvbnRleHQsIHBhcnRpYWxzLCB0aGlzKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRhaWwubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY29udGV4dC5wdXNoKHRhaWxbaV0pO1xuICAgICAgICBzZWN0aW9uKGNvbnRleHQsIHBhcnRpYWxzLCB0aGlzKTtcbiAgICAgICAgY29udGV4dC5wb3AoKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgLy8gbWF5YmUgc3RhcnQgYSBzZWN0aW9uXG4gICAgczogZnVuY3Rpb24odmFsLCBjdHgsIHBhcnRpYWxzLCBpbnZlcnRlZCwgc3RhcnQsIGVuZCwgdGFncykge1xuICAgICAgdmFyIHBhc3M7XG5cbiAgICAgIGlmIChpc0FycmF5KHZhbCkgJiYgdmFsLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlb2YgdmFsID09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdmFsID0gdGhpcy5tcyh2YWwsIGN0eCwgcGFydGlhbHMsIGludmVydGVkLCBzdGFydCwgZW5kLCB0YWdzKTtcbiAgICAgIH1cblxuICAgICAgcGFzcyA9ICEhdmFsO1xuXG4gICAgICBpZiAoIWludmVydGVkICYmIHBhc3MgJiYgY3R4KSB7XG4gICAgICAgIGN0eC5wdXNoKCh0eXBlb2YgdmFsID09ICdvYmplY3QnKSA/IHZhbCA6IGN0eFtjdHgubGVuZ3RoIC0gMV0pO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcGFzcztcbiAgICB9LFxuXG4gICAgLy8gZmluZCB2YWx1ZXMgd2l0aCBkb3R0ZWQgbmFtZXNcbiAgICBkOiBmdW5jdGlvbihrZXksIGN0eCwgcGFydGlhbHMsIHJldHVybkZvdW5kKSB7XG4gICAgICB2YXIgZm91bmQsXG4gICAgICAgICAgbmFtZXMgPSBrZXkuc3BsaXQoJy4nKSxcbiAgICAgICAgICB2YWwgPSB0aGlzLmYobmFtZXNbMF0sIGN0eCwgcGFydGlhbHMsIHJldHVybkZvdW5kKSxcbiAgICAgICAgICBkb01vZGVsR2V0ID0gdGhpcy5vcHRpb25zLm1vZGVsR2V0LFxuICAgICAgICAgIGN4ID0gbnVsbDtcblxuICAgICAgaWYgKGtleSA9PT0gJy4nICYmIGlzQXJyYXkoY3R4W2N0eC5sZW5ndGggLSAyXSkpIHtcbiAgICAgICAgdmFsID0gY3R4W2N0eC5sZW5ndGggLSAxXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAxOyBpIDwgbmFtZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICBmb3VuZCA9IGZpbmRJblNjb3BlKG5hbWVzW2ldLCB2YWwsIGRvTW9kZWxHZXQpO1xuICAgICAgICAgIGlmIChmb3VuZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjeCA9IHZhbDtcbiAgICAgICAgICAgIHZhbCA9IGZvdW5kO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB2YWwgPSAnJztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHJldHVybkZvdW5kICYmICF2YWwpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuXG4gICAgICBpZiAoIXJldHVybkZvdW5kICYmIHR5cGVvZiB2YWwgPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBjdHgucHVzaChjeCk7XG4gICAgICAgIHZhbCA9IHRoaXMubXYodmFsLCBjdHgsIHBhcnRpYWxzKTtcbiAgICAgICAgY3R4LnBvcCgpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gdmFsO1xuICAgIH0sXG5cbiAgICAvLyBmaW5kIHZhbHVlcyB3aXRoIG5vcm1hbCBuYW1lc1xuICAgIGY6IGZ1bmN0aW9uKGtleSwgY3R4LCBwYXJ0aWFscywgcmV0dXJuRm91bmQpIHtcbiAgICAgIHZhciB2YWwgPSBmYWxzZSxcbiAgICAgICAgICB2ID0gbnVsbCxcbiAgICAgICAgICBmb3VuZCA9IGZhbHNlLFxuICAgICAgICAgIGRvTW9kZWxHZXQgPSB0aGlzLm9wdGlvbnMubW9kZWxHZXQ7XG5cbiAgICAgIGZvciAodmFyIGkgPSBjdHgubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgICAgdiA9IGN0eFtpXTtcbiAgICAgICAgdmFsID0gZmluZEluU2NvcGUoa2V5LCB2LCBkb01vZGVsR2V0KTtcbiAgICAgICAgaWYgKHZhbCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgZm91bmQgPSB0cnVlO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmICghZm91bmQpIHtcbiAgICAgICAgcmV0dXJuIChyZXR1cm5Gb3VuZCkgPyBmYWxzZSA6IFwiXCI7XG4gICAgICB9XG5cbiAgICAgIGlmICghcmV0dXJuRm91bmQgJiYgdHlwZW9mIHZhbCA9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHZhbCA9IHRoaXMubXYodmFsLCBjdHgsIHBhcnRpYWxzKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHZhbDtcbiAgICB9LFxuXG4gICAgLy8gaGlnaGVyIG9yZGVyIHRlbXBsYXRlc1xuICAgIGxzOiBmdW5jdGlvbihmdW5jLCBjeCwgcGFydGlhbHMsIHRleHQsIHRhZ3MpIHtcbiAgICAgIHZhciBvbGRUYWdzID0gdGhpcy5vcHRpb25zLmRlbGltaXRlcnM7XG5cbiAgICAgIHRoaXMub3B0aW9ucy5kZWxpbWl0ZXJzID0gdGFncztcbiAgICAgIHRoaXMuYih0aGlzLmN0KGNvZXJjZVRvU3RyaW5nKGZ1bmMuY2FsbChjeCwgdGV4dCkpLCBjeCwgcGFydGlhbHMpKTtcbiAgICAgIHRoaXMub3B0aW9ucy5kZWxpbWl0ZXJzID0gb2xkVGFncztcblxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH0sXG5cbiAgICAvLyBjb21waWxlIHRleHRcbiAgICBjdDogZnVuY3Rpb24odGV4dCwgY3gsIHBhcnRpYWxzKSB7XG4gICAgICBpZiAodGhpcy5vcHRpb25zLmRpc2FibGVMYW1iZGEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdMYW1iZGEgZmVhdHVyZXMgZGlzYWJsZWQuJyk7XG4gICAgICB9XG4gICAgICByZXR1cm4gdGhpcy5jLmNvbXBpbGUodGV4dCwgdGhpcy5vcHRpb25zKS5yZW5kZXIoY3gsIHBhcnRpYWxzKTtcbiAgICB9LFxuXG4gICAgLy8gdGVtcGxhdGUgcmVzdWx0IGJ1ZmZlcmluZ1xuICAgIGI6IGZ1bmN0aW9uKHMpIHsgdGhpcy5idWYgKz0gczsgfSxcblxuICAgIGZsOiBmdW5jdGlvbigpIHsgdmFyIHIgPSB0aGlzLmJ1ZjsgdGhpcy5idWYgPSAnJzsgcmV0dXJuIHI7IH0sXG5cbiAgICAvLyBtZXRob2QgcmVwbGFjZSBzZWN0aW9uXG4gICAgbXM6IGZ1bmN0aW9uKGZ1bmMsIGN0eCwgcGFydGlhbHMsIGludmVydGVkLCBzdGFydCwgZW5kLCB0YWdzKSB7XG4gICAgICB2YXIgdGV4dFNvdXJjZSxcbiAgICAgICAgICBjeCA9IGN0eFtjdHgubGVuZ3RoIC0gMV0sXG4gICAgICAgICAgcmVzdWx0ID0gZnVuYy5jYWxsKGN4KTtcblxuICAgICAgaWYgKHR5cGVvZiByZXN1bHQgPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBpZiAoaW52ZXJ0ZWQpIHtcbiAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0ZXh0U291cmNlID0gKHRoaXMuYWN0aXZlU3ViICYmIHRoaXMuc3Vic1RleHQgJiYgdGhpcy5zdWJzVGV4dFt0aGlzLmFjdGl2ZVN1Yl0pID8gdGhpcy5zdWJzVGV4dFt0aGlzLmFjdGl2ZVN1Yl0gOiB0aGlzLnRleHQ7XG4gICAgICAgICAgcmV0dXJuIHRoaXMubHMocmVzdWx0LCBjeCwgcGFydGlhbHMsIHRleHRTb3VyY2Uuc3Vic3RyaW5nKHN0YXJ0LCBlbmQpLCB0YWdzKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0sXG5cbiAgICAvLyBtZXRob2QgcmVwbGFjZSB2YXJpYWJsZVxuICAgIG12OiBmdW5jdGlvbihmdW5jLCBjdHgsIHBhcnRpYWxzKSB7XG4gICAgICB2YXIgY3ggPSBjdHhbY3R4Lmxlbmd0aCAtIDFdO1xuICAgICAgdmFyIHJlc3VsdCA9IGZ1bmMuY2FsbChjeCk7XG5cbiAgICAgIGlmICh0eXBlb2YgcmVzdWx0ID09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3QoY29lcmNlVG9TdHJpbmcocmVzdWx0LmNhbGwoY3gpKSwgY3gsIHBhcnRpYWxzKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9LFxuXG4gICAgc3ViOiBmdW5jdGlvbihuYW1lLCBjb250ZXh0LCBwYXJ0aWFscywgaW5kZW50KSB7XG4gICAgICB2YXIgZiA9IHRoaXMuc3Vic1tuYW1lXTtcbiAgICAgIGlmIChmKSB7XG4gICAgICAgIHRoaXMuYWN0aXZlU3ViID0gbmFtZTtcbiAgICAgICAgZihjb250ZXh0LCBwYXJ0aWFscywgdGhpcywgaW5kZW50KTtcbiAgICAgICAgdGhpcy5hY3RpdmVTdWIgPSBmYWxzZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgfTtcblxuICAvL0ZpbmQgYSBrZXkgaW4gYW4gb2JqZWN0XG4gIGZ1bmN0aW9uIGZpbmRJblNjb3BlKGtleSwgc2NvcGUsIGRvTW9kZWxHZXQpIHtcbiAgICB2YXIgdmFsO1xuXG4gICAgaWYgKHNjb3BlICYmIHR5cGVvZiBzY29wZSA9PSAnb2JqZWN0Jykge1xuXG4gICAgICBpZiAoc2NvcGVba2V5XSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHZhbCA9IHNjb3BlW2tleV07XG5cbiAgICAgIC8vIHRyeSBsb29rdXAgd2l0aCBnZXQgZm9yIGJhY2tib25lIG9yIHNpbWlsYXIgbW9kZWwgZGF0YVxuICAgICAgfSBlbHNlIGlmIChkb01vZGVsR2V0ICYmIHNjb3BlLmdldCAmJiB0eXBlb2Ygc2NvcGUuZ2V0ID09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdmFsID0gc2NvcGUuZ2V0KGtleSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHZhbDtcbiAgfVxuXG4gIGZ1bmN0aW9uIGNyZWF0ZVNwZWNpYWxpemVkUGFydGlhbChpbnN0YW5jZSwgc3VicywgcGFydGlhbHMsIHN0YWNrU3Vicywgc3RhY2tQYXJ0aWFscywgc3RhY2tUZXh0KSB7XG4gICAgZnVuY3Rpb24gUGFydGlhbFRlbXBsYXRlKCkge307XG4gICAgUGFydGlhbFRlbXBsYXRlLnByb3RvdHlwZSA9IGluc3RhbmNlO1xuICAgIGZ1bmN0aW9uIFN1YnN0aXR1dGlvbnMoKSB7fTtcbiAgICBTdWJzdGl0dXRpb25zLnByb3RvdHlwZSA9IGluc3RhbmNlLnN1YnM7XG4gICAgdmFyIGtleTtcbiAgICB2YXIgcGFydGlhbCA9IG5ldyBQYXJ0aWFsVGVtcGxhdGUoKTtcbiAgICBwYXJ0aWFsLnN1YnMgPSBuZXcgU3Vic3RpdHV0aW9ucygpO1xuICAgIHBhcnRpYWwuc3Vic1RleHQgPSB7fTsgIC8vaGVoZS4gc3Vic3RleHQuXG4gICAgcGFydGlhbC5idWYgPSAnJztcblxuICAgIHN0YWNrU3VicyA9IHN0YWNrU3VicyB8fCB7fTtcbiAgICBwYXJ0aWFsLnN0YWNrU3VicyA9IHN0YWNrU3VicztcbiAgICBwYXJ0aWFsLnN1YnNUZXh0ID0gc3RhY2tUZXh0O1xuICAgIGZvciAoa2V5IGluIHN1YnMpIHtcbiAgICAgIGlmICghc3RhY2tTdWJzW2tleV0pIHN0YWNrU3Vic1trZXldID0gc3Vic1trZXldO1xuICAgIH1cbiAgICBmb3IgKGtleSBpbiBzdGFja1N1YnMpIHtcbiAgICAgIHBhcnRpYWwuc3Vic1trZXldID0gc3RhY2tTdWJzW2tleV07XG4gICAgfVxuXG4gICAgc3RhY2tQYXJ0aWFscyA9IHN0YWNrUGFydGlhbHMgfHwge307XG4gICAgcGFydGlhbC5zdGFja1BhcnRpYWxzID0gc3RhY2tQYXJ0aWFscztcbiAgICBmb3IgKGtleSBpbiBwYXJ0aWFscykge1xuICAgICAgaWYgKCFzdGFja1BhcnRpYWxzW2tleV0pIHN0YWNrUGFydGlhbHNba2V5XSA9IHBhcnRpYWxzW2tleV07XG4gICAgfVxuICAgIGZvciAoa2V5IGluIHN0YWNrUGFydGlhbHMpIHtcbiAgICAgIHBhcnRpYWwucGFydGlhbHNba2V5XSA9IHN0YWNrUGFydGlhbHNba2V5XTtcbiAgICB9XG5cbiAgICByZXR1cm4gcGFydGlhbDtcbiAgfVxuXG4gIHZhciByQW1wID0gLyYvZyxcbiAgICAgIHJMdCA9IC88L2csXG4gICAgICByR3QgPSAvPi9nLFxuICAgICAgckFwb3MgPSAvXFwnL2csXG4gICAgICByUXVvdCA9IC9cXFwiL2csXG4gICAgICBoQ2hhcnMgPSAvWyY8PlxcXCJcXCddLztcblxuICBmdW5jdGlvbiBjb2VyY2VUb1N0cmluZyh2YWwpIHtcbiAgICByZXR1cm4gU3RyaW5nKCh2YWwgPT09IG51bGwgfHwgdmFsID09PSB1bmRlZmluZWQpID8gJycgOiB2YWwpO1xuICB9XG5cbiAgZnVuY3Rpb24gaG9nYW5Fc2NhcGUoc3RyKSB7XG4gICAgc3RyID0gY29lcmNlVG9TdHJpbmcoc3RyKTtcbiAgICByZXR1cm4gaENoYXJzLnRlc3Qoc3RyKSA/XG4gICAgICBzdHJcbiAgICAgICAgLnJlcGxhY2UockFtcCwgJyZhbXA7JylcbiAgICAgICAgLnJlcGxhY2Uockx0LCAnJmx0OycpXG4gICAgICAgIC5yZXBsYWNlKHJHdCwgJyZndDsnKVxuICAgICAgICAucmVwbGFjZShyQXBvcywgJyYjMzk7JylcbiAgICAgICAgLnJlcGxhY2UoclF1b3QsICcmcXVvdDsnKSA6XG4gICAgICBzdHI7XG4gIH1cblxuICB2YXIgaXNBcnJheSA9IEFycmF5LmlzQXJyYXkgfHwgZnVuY3Rpb24oYSkge1xuICAgIHJldHVybiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoYSkgPT09ICdbb2JqZWN0IEFycmF5XSc7XG4gIH07XG5cbn0pKHR5cGVvZiBleHBvcnRzICE9PSAndW5kZWZpbmVkJyA/IGV4cG9ydHMgOiBIb2dhbik7XG5cblxuXG4oZnVuY3Rpb24gKEhvZ2FuKSB7XG4gIC8vIFNldHVwIHJlZ2V4ICBhc3NpZ25tZW50c1xuICAvLyByZW1vdmUgd2hpdGVzcGFjZSBhY2NvcmRpbmcgdG8gTXVzdGFjaGUgc3BlY1xuICB2YXIgcklzV2hpdGVzcGFjZSA9IC9cXFMvLFxuICAgICAgclF1b3QgPSAvXFxcIi9nLFxuICAgICAgck5ld2xpbmUgPSAgL1xcbi9nLFxuICAgICAgckNyID0gL1xcci9nLFxuICAgICAgclNsYXNoID0gL1xcXFwvZyxcbiAgICAgIHJMaW5lU2VwID0gL1xcdTIwMjgvLFxuICAgICAgclBhcmFncmFwaFNlcCA9IC9cXHUyMDI5LztcblxuICBIb2dhbi50YWdzID0ge1xuICAgICcjJzogMSwgJ14nOiAyLCAnPCc6IDMsICckJzogNCxcbiAgICAnLyc6IDUsICchJzogNiwgJz4nOiA3LCAnPSc6IDgsICdfdic6IDksXG4gICAgJ3snOiAxMCwgJyYnOiAxMSwgJ190JzogMTJcbiAgfTtcblxuICBIb2dhbi5zY2FuID0gZnVuY3Rpb24gc2Nhbih0ZXh0LCBkZWxpbWl0ZXJzKSB7XG4gICAgdmFyIGxlbiA9IHRleHQubGVuZ3RoLFxuICAgICAgICBJTl9URVhUID0gMCxcbiAgICAgICAgSU5fVEFHX1RZUEUgPSAxLFxuICAgICAgICBJTl9UQUcgPSAyLFxuICAgICAgICBzdGF0ZSA9IElOX1RFWFQsXG4gICAgICAgIHRhZ1R5cGUgPSBudWxsLFxuICAgICAgICB0YWcgPSBudWxsLFxuICAgICAgICBidWYgPSAnJyxcbiAgICAgICAgdG9rZW5zID0gW10sXG4gICAgICAgIHNlZW5UYWcgPSBmYWxzZSxcbiAgICAgICAgaSA9IDAsXG4gICAgICAgIGxpbmVTdGFydCA9IDAsXG4gICAgICAgIG90YWcgPSAne3snLFxuICAgICAgICBjdGFnID0gJ319JztcblxuICAgIGZ1bmN0aW9uIGFkZEJ1ZigpIHtcbiAgICAgIGlmIChidWYubGVuZ3RoID4gMCkge1xuICAgICAgICB0b2tlbnMucHVzaCh7dGFnOiAnX3QnLCB0ZXh0OiBuZXcgU3RyaW5nKGJ1Zil9KTtcbiAgICAgICAgYnVmID0gJyc7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbGluZUlzV2hpdGVzcGFjZSgpIHtcbiAgICAgIHZhciBpc0FsbFdoaXRlc3BhY2UgPSB0cnVlO1xuICAgICAgZm9yICh2YXIgaiA9IGxpbmVTdGFydDsgaiA8IHRva2Vucy5sZW5ndGg7IGorKykge1xuICAgICAgICBpc0FsbFdoaXRlc3BhY2UgPVxuICAgICAgICAgIChIb2dhbi50YWdzW3Rva2Vuc1tqXS50YWddIDwgSG9nYW4udGFnc1snX3YnXSkgfHxcbiAgICAgICAgICAodG9rZW5zW2pdLnRhZyA9PSAnX3QnICYmIHRva2Vuc1tqXS50ZXh0Lm1hdGNoKHJJc1doaXRlc3BhY2UpID09PSBudWxsKTtcbiAgICAgICAgaWYgKCFpc0FsbFdoaXRlc3BhY2UpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGlzQWxsV2hpdGVzcGFjZTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmaWx0ZXJMaW5lKGhhdmVTZWVuVGFnLCBub05ld0xpbmUpIHtcbiAgICAgIGFkZEJ1ZigpO1xuXG4gICAgICBpZiAoaGF2ZVNlZW5UYWcgJiYgbGluZUlzV2hpdGVzcGFjZSgpKSB7XG4gICAgICAgIGZvciAodmFyIGogPSBsaW5lU3RhcnQsIG5leHQ7IGogPCB0b2tlbnMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICBpZiAodG9rZW5zW2pdLnRleHQpIHtcbiAgICAgICAgICAgIGlmICgobmV4dCA9IHRva2Vuc1tqKzFdKSAmJiBuZXh0LnRhZyA9PSAnPicpIHtcbiAgICAgICAgICAgICAgLy8gc2V0IGluZGVudCB0byB0b2tlbiB2YWx1ZVxuICAgICAgICAgICAgICBuZXh0LmluZGVudCA9IHRva2Vuc1tqXS50ZXh0LnRvU3RyaW5nKClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRva2Vucy5zcGxpY2UoaiwgMSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKCFub05ld0xpbmUpIHtcbiAgICAgICAgdG9rZW5zLnB1c2goe3RhZzonXFxuJ30pO1xuICAgICAgfVxuXG4gICAgICBzZWVuVGFnID0gZmFsc2U7XG4gICAgICBsaW5lU3RhcnQgPSB0b2tlbnMubGVuZ3RoO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNoYW5nZURlbGltaXRlcnModGV4dCwgaW5kZXgpIHtcbiAgICAgIHZhciBjbG9zZSA9ICc9JyArIGN0YWcsXG4gICAgICAgICAgY2xvc2VJbmRleCA9IHRleHQuaW5kZXhPZihjbG9zZSwgaW5kZXgpLFxuICAgICAgICAgIGRlbGltaXRlcnMgPSB0cmltKFxuICAgICAgICAgICAgdGV4dC5zdWJzdHJpbmcodGV4dC5pbmRleE9mKCc9JywgaW5kZXgpICsgMSwgY2xvc2VJbmRleClcbiAgICAgICAgICApLnNwbGl0KCcgJyk7XG5cbiAgICAgIG90YWcgPSBkZWxpbWl0ZXJzWzBdO1xuICAgICAgY3RhZyA9IGRlbGltaXRlcnNbZGVsaW1pdGVycy5sZW5ndGggLSAxXTtcblxuICAgICAgcmV0dXJuIGNsb3NlSW5kZXggKyBjbG9zZS5sZW5ndGggLSAxO1xuICAgIH1cblxuICAgIGlmIChkZWxpbWl0ZXJzKSB7XG4gICAgICBkZWxpbWl0ZXJzID0gZGVsaW1pdGVycy5zcGxpdCgnICcpO1xuICAgICAgb3RhZyA9IGRlbGltaXRlcnNbMF07XG4gICAgICBjdGFnID0gZGVsaW1pdGVyc1sxXTtcbiAgICB9XG5cbiAgICBmb3IgKGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIGlmIChzdGF0ZSA9PSBJTl9URVhUKSB7XG4gICAgICAgIGlmICh0YWdDaGFuZ2Uob3RhZywgdGV4dCwgaSkpIHtcbiAgICAgICAgICAtLWk7XG4gICAgICAgICAgYWRkQnVmKCk7XG4gICAgICAgICAgc3RhdGUgPSBJTl9UQUdfVFlQRTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBpZiAodGV4dC5jaGFyQXQoaSkgPT0gJ1xcbicpIHtcbiAgICAgICAgICAgIGZpbHRlckxpbmUoc2VlblRhZyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGJ1ZiArPSB0ZXh0LmNoYXJBdChpKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoc3RhdGUgPT0gSU5fVEFHX1RZUEUpIHtcbiAgICAgICAgaSArPSBvdGFnLmxlbmd0aCAtIDE7XG4gICAgICAgIHRhZyA9IEhvZ2FuLnRhZ3NbdGV4dC5jaGFyQXQoaSArIDEpXTtcbiAgICAgICAgdGFnVHlwZSA9IHRhZyA/IHRleHQuY2hhckF0KGkgKyAxKSA6ICdfdic7XG4gICAgICAgIGlmICh0YWdUeXBlID09ICc9Jykge1xuICAgICAgICAgIGkgPSBjaGFuZ2VEZWxpbWl0ZXJzKHRleHQsIGkpO1xuICAgICAgICAgIHN0YXRlID0gSU5fVEVYVDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBpZiAodGFnKSB7XG4gICAgICAgICAgICBpKys7XG4gICAgICAgICAgfVxuICAgICAgICAgIHN0YXRlID0gSU5fVEFHO1xuICAgICAgICB9XG4gICAgICAgIHNlZW5UYWcgPSBpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHRhZ0NoYW5nZShjdGFnLCB0ZXh0LCBpKSkge1xuICAgICAgICAgIHRva2Vucy5wdXNoKHt0YWc6IHRhZ1R5cGUsIG46IHRyaW0oYnVmKSwgb3RhZzogb3RhZywgY3RhZzogY3RhZyxcbiAgICAgICAgICAgICAgICAgICAgICAgaTogKHRhZ1R5cGUgPT0gJy8nKSA/IHNlZW5UYWcgLSBvdGFnLmxlbmd0aCA6IGkgKyBjdGFnLmxlbmd0aH0pO1xuICAgICAgICAgIGJ1ZiA9ICcnO1xuICAgICAgICAgIGkgKz0gY3RhZy5sZW5ndGggLSAxO1xuICAgICAgICAgIHN0YXRlID0gSU5fVEVYVDtcbiAgICAgICAgICBpZiAodGFnVHlwZSA9PSAneycpIHtcbiAgICAgICAgICAgIGlmIChjdGFnID09ICd9fScpIHtcbiAgICAgICAgICAgICAgaSsrO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgY2xlYW5UcmlwbGVTdGFjaGUodG9rZW5zW3Rva2Vucy5sZW5ndGggLSAxXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGJ1ZiArPSB0ZXh0LmNoYXJBdChpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGZpbHRlckxpbmUoc2VlblRhZywgdHJ1ZSk7XG5cbiAgICByZXR1cm4gdG9rZW5zO1xuICB9XG5cbiAgZnVuY3Rpb24gY2xlYW5UcmlwbGVTdGFjaGUodG9rZW4pIHtcbiAgICBpZiAodG9rZW4ubi5zdWJzdHIodG9rZW4ubi5sZW5ndGggLSAxKSA9PT0gJ30nKSB7XG4gICAgICB0b2tlbi5uID0gdG9rZW4ubi5zdWJzdHJpbmcoMCwgdG9rZW4ubi5sZW5ndGggLSAxKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiB0cmltKHMpIHtcbiAgICBpZiAocy50cmltKSB7XG4gICAgICByZXR1cm4gcy50cmltKCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHMucmVwbGFjZSgvXlxccyp8XFxzKiQvZywgJycpO1xuICB9XG5cbiAgZnVuY3Rpb24gdGFnQ2hhbmdlKHRhZywgdGV4dCwgaW5kZXgpIHtcbiAgICBpZiAodGV4dC5jaGFyQXQoaW5kZXgpICE9IHRhZy5jaGFyQXQoMCkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBmb3IgKHZhciBpID0gMSwgbCA9IHRhZy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgIGlmICh0ZXh0LmNoYXJBdChpbmRleCArIGkpICE9IHRhZy5jaGFyQXQoaSkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLy8gdGhlIHRhZ3MgYWxsb3dlZCBpbnNpZGUgc3VwZXIgdGVtcGxhdGVzXG4gIHZhciBhbGxvd2VkSW5TdXBlciA9IHsnX3QnOiB0cnVlLCAnXFxuJzogdHJ1ZSwgJyQnOiB0cnVlLCAnLyc6IHRydWV9O1xuXG4gIGZ1bmN0aW9uIGJ1aWxkVHJlZSh0b2tlbnMsIGtpbmQsIHN0YWNrLCBjdXN0b21UYWdzKSB7XG4gICAgdmFyIGluc3RydWN0aW9ucyA9IFtdLFxuICAgICAgICBvcGVuZXIgPSBudWxsLFxuICAgICAgICB0YWlsID0gbnVsbCxcbiAgICAgICAgdG9rZW4gPSBudWxsO1xuXG4gICAgdGFpbCA9IHN0YWNrW3N0YWNrLmxlbmd0aCAtIDFdO1xuXG4gICAgd2hpbGUgKHRva2Vucy5sZW5ndGggPiAwKSB7XG4gICAgICB0b2tlbiA9IHRva2Vucy5zaGlmdCgpO1xuXG4gICAgICBpZiAodGFpbCAmJiB0YWlsLnRhZyA9PSAnPCcgJiYgISh0b2tlbi50YWcgaW4gYWxsb3dlZEluU3VwZXIpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignSWxsZWdhbCBjb250ZW50IGluIDwgc3VwZXIgdGFnLicpO1xuICAgICAgfVxuXG4gICAgICBpZiAoSG9nYW4udGFnc1t0b2tlbi50YWddIDw9IEhvZ2FuLnRhZ3NbJyQnXSB8fCBpc09wZW5lcih0b2tlbiwgY3VzdG9tVGFncykpIHtcbiAgICAgICAgc3RhY2sucHVzaCh0b2tlbik7XG4gICAgICAgIHRva2VuLm5vZGVzID0gYnVpbGRUcmVlKHRva2VucywgdG9rZW4udGFnLCBzdGFjaywgY3VzdG9tVGFncyk7XG4gICAgICB9IGVsc2UgaWYgKHRva2VuLnRhZyA9PSAnLycpIHtcbiAgICAgICAgaWYgKHN0YWNrLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQ2xvc2luZyB0YWcgd2l0aG91dCBvcGVuZXI6IC8nICsgdG9rZW4ubik7XG4gICAgICAgIH1cbiAgICAgICAgb3BlbmVyID0gc3RhY2sucG9wKCk7XG4gICAgICAgIGlmICh0b2tlbi5uICE9IG9wZW5lci5uICYmICFpc0Nsb3Nlcih0b2tlbi5uLCBvcGVuZXIubiwgY3VzdG9tVGFncykpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05lc3RpbmcgZXJyb3I6ICcgKyBvcGVuZXIubiArICcgdnMuICcgKyB0b2tlbi5uKTtcbiAgICAgICAgfVxuICAgICAgICBvcGVuZXIuZW5kID0gdG9rZW4uaTtcbiAgICAgICAgcmV0dXJuIGluc3RydWN0aW9ucztcbiAgICAgIH0gZWxzZSBpZiAodG9rZW4udGFnID09ICdcXG4nKSB7XG4gICAgICAgIHRva2VuLmxhc3QgPSAodG9rZW5zLmxlbmd0aCA9PSAwKSB8fCAodG9rZW5zWzBdLnRhZyA9PSAnXFxuJyk7XG4gICAgICB9XG5cbiAgICAgIGluc3RydWN0aW9ucy5wdXNoKHRva2VuKTtcbiAgICB9XG5cbiAgICBpZiAoc3RhY2subGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdtaXNzaW5nIGNsb3NpbmcgdGFnOiAnICsgc3RhY2sucG9wKCkubik7XG4gICAgfVxuXG4gICAgcmV0dXJuIGluc3RydWN0aW9ucztcbiAgfVxuXG4gIGZ1bmN0aW9uIGlzT3BlbmVyKHRva2VuLCB0YWdzKSB7XG4gICAgZm9yICh2YXIgaSA9IDAsIGwgPSB0YWdzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgaWYgKHRhZ3NbaV0ubyA9PSB0b2tlbi5uKSB7XG4gICAgICAgIHRva2VuLnRhZyA9ICcjJztcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gaXNDbG9zZXIoY2xvc2UsIG9wZW4sIHRhZ3MpIHtcbiAgICBmb3IgKHZhciBpID0gMCwgbCA9IHRhZ3MubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICBpZiAodGFnc1tpXS5jID09IGNsb3NlICYmIHRhZ3NbaV0ubyA9PSBvcGVuKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHN0cmluZ2lmeVN1YnN0aXR1dGlvbnMob2JqKSB7XG4gICAgdmFyIGl0ZW1zID0gW107XG4gICAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgICAgaXRlbXMucHVzaCgnXCInICsgZXNjKGtleSkgKyAnXCI6IGZ1bmN0aW9uKGMscCx0LGkpIHsnICsgb2JqW2tleV0gKyAnfScpO1xuICAgIH1cbiAgICByZXR1cm4gXCJ7IFwiICsgaXRlbXMuam9pbihcIixcIikgKyBcIiB9XCI7XG4gIH1cblxuICBmdW5jdGlvbiBzdHJpbmdpZnlQYXJ0aWFscyhjb2RlT2JqKSB7XG4gICAgdmFyIHBhcnRpYWxzID0gW107XG4gICAgZm9yICh2YXIga2V5IGluIGNvZGVPYmoucGFydGlhbHMpIHtcbiAgICAgIHBhcnRpYWxzLnB1c2goJ1wiJyArIGVzYyhrZXkpICsgJ1wiOntuYW1lOlwiJyArIGVzYyhjb2RlT2JqLnBhcnRpYWxzW2tleV0ubmFtZSkgKyAnXCIsICcgKyBzdHJpbmdpZnlQYXJ0aWFscyhjb2RlT2JqLnBhcnRpYWxzW2tleV0pICsgXCJ9XCIpO1xuICAgIH1cbiAgICByZXR1cm4gXCJwYXJ0aWFsczoge1wiICsgcGFydGlhbHMuam9pbihcIixcIikgKyBcIn0sIHN1YnM6IFwiICsgc3RyaW5naWZ5U3Vic3RpdHV0aW9ucyhjb2RlT2JqLnN1YnMpO1xuICB9XG5cbiAgSG9nYW4uc3RyaW5naWZ5ID0gZnVuY3Rpb24oY29kZU9iaiwgdGV4dCwgb3B0aW9ucykge1xuICAgIHJldHVybiBcIntjb2RlOiBmdW5jdGlvbiAoYyxwLGkpIHsgXCIgKyBIb2dhbi53cmFwTWFpbihjb2RlT2JqLmNvZGUpICsgXCIgfSxcIiArIHN0cmluZ2lmeVBhcnRpYWxzKGNvZGVPYmopICsgIFwifVwiO1xuICB9XG5cbiAgdmFyIHNlcmlhbE5vID0gMDtcbiAgSG9nYW4uZ2VuZXJhdGUgPSBmdW5jdGlvbih0cmVlLCB0ZXh0LCBvcHRpb25zKSB7XG4gICAgc2VyaWFsTm8gPSAwO1xuICAgIHZhciBjb250ZXh0ID0geyBjb2RlOiAnJywgc3Viczoge30sIHBhcnRpYWxzOiB7fSB9O1xuICAgIEhvZ2FuLndhbGsodHJlZSwgY29udGV4dCk7XG5cbiAgICBpZiAob3B0aW9ucy5hc1N0cmluZykge1xuICAgICAgcmV0dXJuIHRoaXMuc3RyaW5naWZ5KGNvbnRleHQsIHRleHQsIG9wdGlvbnMpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLm1ha2VUZW1wbGF0ZShjb250ZXh0LCB0ZXh0LCBvcHRpb25zKTtcbiAgfVxuXG4gIEhvZ2FuLndyYXBNYWluID0gZnVuY3Rpb24oY29kZSkge1xuICAgIHJldHVybiAndmFyIHQ9dGhpczt0LmIoaT1pfHxcIlwiKTsnICsgY29kZSArICdyZXR1cm4gdC5mbCgpOyc7XG4gIH1cblxuICBIb2dhbi50ZW1wbGF0ZSA9IEhvZ2FuLlRlbXBsYXRlO1xuXG4gIEhvZ2FuLm1ha2VUZW1wbGF0ZSA9IGZ1bmN0aW9uKGNvZGVPYmosIHRleHQsIG9wdGlvbnMpIHtcbiAgICB2YXIgdGVtcGxhdGUgPSB0aGlzLm1ha2VQYXJ0aWFscyhjb2RlT2JqKTtcbiAgICB0ZW1wbGF0ZS5jb2RlID0gbmV3IEZ1bmN0aW9uKCdjJywgJ3AnLCAnaScsIHRoaXMud3JhcE1haW4oY29kZU9iai5jb2RlKSk7XG4gICAgcmV0dXJuIG5ldyB0aGlzLnRlbXBsYXRlKHRlbXBsYXRlLCB0ZXh0LCB0aGlzLCBvcHRpb25zKTtcbiAgfVxuXG4gIEhvZ2FuLm1ha2VQYXJ0aWFscyA9IGZ1bmN0aW9uKGNvZGVPYmopIHtcbiAgICB2YXIga2V5LCB0ZW1wbGF0ZSA9IHtzdWJzOiB7fSwgcGFydGlhbHM6IGNvZGVPYmoucGFydGlhbHMsIG5hbWU6IGNvZGVPYmoubmFtZX07XG4gICAgZm9yIChrZXkgaW4gdGVtcGxhdGUucGFydGlhbHMpIHtcbiAgICAgIHRlbXBsYXRlLnBhcnRpYWxzW2tleV0gPSB0aGlzLm1ha2VQYXJ0aWFscyh0ZW1wbGF0ZS5wYXJ0aWFsc1trZXldKTtcbiAgICB9XG4gICAgZm9yIChrZXkgaW4gY29kZU9iai5zdWJzKSB7XG4gICAgICB0ZW1wbGF0ZS5zdWJzW2tleV0gPSBuZXcgRnVuY3Rpb24oJ2MnLCAncCcsICd0JywgJ2knLCBjb2RlT2JqLnN1YnNba2V5XSk7XG4gICAgfVxuICAgIHJldHVybiB0ZW1wbGF0ZTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGVzYyhzKSB7XG4gICAgcmV0dXJuIHMucmVwbGFjZShyU2xhc2gsICdcXFxcXFxcXCcpXG4gICAgICAgICAgICAucmVwbGFjZShyUXVvdCwgJ1xcXFxcXFwiJylcbiAgICAgICAgICAgIC5yZXBsYWNlKHJOZXdsaW5lLCAnXFxcXG4nKVxuICAgICAgICAgICAgLnJlcGxhY2UockNyLCAnXFxcXHInKVxuICAgICAgICAgICAgLnJlcGxhY2UockxpbmVTZXAsICdcXFxcdTIwMjgnKVxuICAgICAgICAgICAgLnJlcGxhY2UoclBhcmFncmFwaFNlcCwgJ1xcXFx1MjAyOScpO1xuICB9XG5cbiAgZnVuY3Rpb24gY2hvb3NlTWV0aG9kKHMpIHtcbiAgICByZXR1cm4gKH5zLmluZGV4T2YoJy4nKSkgPyAnZCcgOiAnZic7XG4gIH1cblxuICBmdW5jdGlvbiBjcmVhdGVQYXJ0aWFsKG5vZGUsIGNvbnRleHQpIHtcbiAgICB2YXIgcHJlZml4ID0gXCI8XCIgKyAoY29udGV4dC5wcmVmaXggfHwgXCJcIik7XG4gICAgdmFyIHN5bSA9IHByZWZpeCArIG5vZGUubiArIHNlcmlhbE5vKys7XG4gICAgY29udGV4dC5wYXJ0aWFsc1tzeW1dID0ge25hbWU6IG5vZGUubiwgcGFydGlhbHM6IHt9fTtcbiAgICBjb250ZXh0LmNvZGUgKz0gJ3QuYih0LnJwKFwiJyArICBlc2Moc3ltKSArICdcIixjLHAsXCInICsgKG5vZGUuaW5kZW50IHx8ICcnKSArICdcIikpOyc7XG4gICAgcmV0dXJuIHN5bTtcbiAgfVxuXG4gIEhvZ2FuLmNvZGVnZW4gPSB7XG4gICAgJyMnOiBmdW5jdGlvbihub2RlLCBjb250ZXh0KSB7XG4gICAgICBjb250ZXh0LmNvZGUgKz0gJ2lmKHQucyh0LicgKyBjaG9vc2VNZXRob2Qobm9kZS5uKSArICcoXCInICsgZXNjKG5vZGUubikgKyAnXCIsYyxwLDEpLCcgK1xuICAgICAgICAgICAgICAgICAgICAgICdjLHAsMCwnICsgbm9kZS5pICsgJywnICsgbm9kZS5lbmQgKyAnLFwiJyArIG5vZGUub3RhZyArIFwiIFwiICsgbm9kZS5jdGFnICsgJ1wiKSl7JyArXG4gICAgICAgICAgICAgICAgICAgICAgJ3QucnMoYyxwLCcgKyAnZnVuY3Rpb24oYyxwLHQpeyc7XG4gICAgICBIb2dhbi53YWxrKG5vZGUubm9kZXMsIGNvbnRleHQpO1xuICAgICAgY29udGV4dC5jb2RlICs9ICd9KTtjLnBvcCgpO30nO1xuICAgIH0sXG5cbiAgICAnXic6IGZ1bmN0aW9uKG5vZGUsIGNvbnRleHQpIHtcbiAgICAgIGNvbnRleHQuY29kZSArPSAnaWYoIXQucyh0LicgKyBjaG9vc2VNZXRob2Qobm9kZS5uKSArICcoXCInICsgZXNjKG5vZGUubikgKyAnXCIsYyxwLDEpLGMscCwxLDAsMCxcIlwiKSl7JztcbiAgICAgIEhvZ2FuLndhbGsobm9kZS5ub2RlcywgY29udGV4dCk7XG4gICAgICBjb250ZXh0LmNvZGUgKz0gJ307JztcbiAgICB9LFxuXG4gICAgJz4nOiBjcmVhdGVQYXJ0aWFsLFxuICAgICc8JzogZnVuY3Rpb24obm9kZSwgY29udGV4dCkge1xuICAgICAgdmFyIGN0eCA9IHtwYXJ0aWFsczoge30sIGNvZGU6ICcnLCBzdWJzOiB7fSwgaW5QYXJ0aWFsOiB0cnVlfTtcbiAgICAgIEhvZ2FuLndhbGsobm9kZS5ub2RlcywgY3R4KTtcbiAgICAgIHZhciB0ZW1wbGF0ZSA9IGNvbnRleHQucGFydGlhbHNbY3JlYXRlUGFydGlhbChub2RlLCBjb250ZXh0KV07XG4gICAgICB0ZW1wbGF0ZS5zdWJzID0gY3R4LnN1YnM7XG4gICAgICB0ZW1wbGF0ZS5wYXJ0aWFscyA9IGN0eC5wYXJ0aWFscztcbiAgICB9LFxuXG4gICAgJyQnOiBmdW5jdGlvbihub2RlLCBjb250ZXh0KSB7XG4gICAgICB2YXIgY3R4ID0ge3N1YnM6IHt9LCBjb2RlOiAnJywgcGFydGlhbHM6IGNvbnRleHQucGFydGlhbHMsIHByZWZpeDogbm9kZS5ufTtcbiAgICAgIEhvZ2FuLndhbGsobm9kZS5ub2RlcywgY3R4KTtcbiAgICAgIGNvbnRleHQuc3Vic1tub2RlLm5dID0gY3R4LmNvZGU7XG4gICAgICBpZiAoIWNvbnRleHQuaW5QYXJ0aWFsKSB7XG4gICAgICAgIGNvbnRleHQuY29kZSArPSAndC5zdWIoXCInICsgZXNjKG5vZGUubikgKyAnXCIsYyxwLGkpOyc7XG4gICAgICB9XG4gICAgfSxcblxuICAgICdcXG4nOiBmdW5jdGlvbihub2RlLCBjb250ZXh0KSB7XG4gICAgICBjb250ZXh0LmNvZGUgKz0gd3JpdGUoJ1wiXFxcXG5cIicgKyAobm9kZS5sYXN0ID8gJycgOiAnICsgaScpKTtcbiAgICB9LFxuXG4gICAgJ192JzogZnVuY3Rpb24obm9kZSwgY29udGV4dCkge1xuICAgICAgY29udGV4dC5jb2RlICs9ICd0LmIodC52KHQuJyArIGNob29zZU1ldGhvZChub2RlLm4pICsgJyhcIicgKyBlc2Mobm9kZS5uKSArICdcIixjLHAsMCkpKTsnO1xuICAgIH0sXG5cbiAgICAnX3QnOiBmdW5jdGlvbihub2RlLCBjb250ZXh0KSB7XG4gICAgICBjb250ZXh0LmNvZGUgKz0gd3JpdGUoJ1wiJyArIGVzYyhub2RlLnRleHQpICsgJ1wiJyk7XG4gICAgfSxcblxuICAgICd7JzogdHJpcGxlU3RhY2hlLFxuXG4gICAgJyYnOiB0cmlwbGVTdGFjaGVcbiAgfVxuXG4gIGZ1bmN0aW9uIHRyaXBsZVN0YWNoZShub2RlLCBjb250ZXh0KSB7XG4gICAgY29udGV4dC5jb2RlICs9ICd0LmIodC50KHQuJyArIGNob29zZU1ldGhvZChub2RlLm4pICsgJyhcIicgKyBlc2Mobm9kZS5uKSArICdcIixjLHAsMCkpKTsnO1xuICB9XG5cbiAgZnVuY3Rpb24gd3JpdGUocykge1xuICAgIHJldHVybiAndC5iKCcgKyBzICsgJyk7JztcbiAgfVxuXG4gIEhvZ2FuLndhbGsgPSBmdW5jdGlvbihub2RlbGlzdCwgY29udGV4dCkge1xuICAgIHZhciBmdW5jO1xuICAgIGZvciAodmFyIGkgPSAwLCBsID0gbm9kZWxpc3QubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICBmdW5jID0gSG9nYW4uY29kZWdlbltub2RlbGlzdFtpXS50YWddO1xuICAgICAgZnVuYyAmJiBmdW5jKG5vZGVsaXN0W2ldLCBjb250ZXh0KTtcbiAgICB9XG4gICAgcmV0dXJuIGNvbnRleHQ7XG4gIH1cblxuICBIb2dhbi5wYXJzZSA9IGZ1bmN0aW9uKHRva2VucywgdGV4dCwgb3B0aW9ucykge1xuICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuICAgIHJldHVybiBidWlsZFRyZWUodG9rZW5zLCAnJywgW10sIG9wdGlvbnMuc2VjdGlvblRhZ3MgfHwgW10pO1xuICB9XG5cbiAgSG9nYW4uY2FjaGUgPSB7fTtcblxuICBIb2dhbi5jYWNoZUtleSA9IGZ1bmN0aW9uKHRleHQsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gW3RleHQsICEhb3B0aW9ucy5hc1N0cmluZywgISFvcHRpb25zLmRpc2FibGVMYW1iZGEsIG9wdGlvbnMuZGVsaW1pdGVycywgISFvcHRpb25zLm1vZGVsR2V0XS5qb2luKCd8fCcpO1xuICB9XG5cbiAgSG9nYW4uY29tcGlsZSA9IGZ1bmN0aW9uKHRleHQsIG9wdGlvbnMpIHtcbiAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgICB2YXIga2V5ID0gSG9nYW4uY2FjaGVLZXkodGV4dCwgb3B0aW9ucyk7XG4gICAgdmFyIHRlbXBsYXRlID0gdGhpcy5jYWNoZVtrZXldO1xuXG4gICAgaWYgKHRlbXBsYXRlKSB7XG4gICAgICB2YXIgcGFydGlhbHMgPSB0ZW1wbGF0ZS5wYXJ0aWFscztcbiAgICAgIGZvciAodmFyIG5hbWUgaW4gcGFydGlhbHMpIHtcbiAgICAgICAgZGVsZXRlIHBhcnRpYWxzW25hbWVdLmluc3RhbmNlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRlbXBsYXRlO1xuICAgIH1cblxuICAgIHRlbXBsYXRlID0gdGhpcy5nZW5lcmF0ZSh0aGlzLnBhcnNlKHRoaXMuc2Nhbih0ZXh0LCBvcHRpb25zLmRlbGltaXRlcnMpLCB0ZXh0LCBvcHRpb25zKSwgdGV4dCwgb3B0aW9ucyk7XG4gICAgcmV0dXJuIHRoaXMuY2FjaGVba2V5XSA9IHRlbXBsYXRlO1xuICB9XG59KSh0eXBlb2YgZXhwb3J0cyAhPT0gJ3VuZGVmaW5lZCcgPyBleHBvcnRzIDogSG9nYW4pO1xuXG4iLCJpZiAoISEhdGVtcGxhdGVzKSB2YXIgdGVtcGxhdGVzID0ge307XG50ZW1wbGF0ZXNbXCJpdGVtXCJdID0gbmV3IEhvZ2FuLlRlbXBsYXRlKHtjb2RlOiBmdW5jdGlvbiAoYyxwLGkpIHsgdmFyIHQ9dGhpczt0LmIoaT1pfHxcIlwiKTt0LmIoXCI8ZGl2IGNsYXNzPVxcXCJpbnN0YV9pdGVtXFxcIj5cIik7dC5iKFwiXFxuXCIgKyBpKTt0LmIoXCJcdDxhIGhyZWY9XFxcIlwiKTt0LmIodC52KHQuZihcImxpbmtcIixjLHAsMCkpKTt0LmIoXCJcXFwiIHRhcmdldD1cXFwiX2JsYW5rXFxcIj5cIik7dC5iKFwiXFxuXCIgKyBpKTtpZighdC5zKHQuZihcInZpZGVvc1wiLGMscCwxKSxjLHAsMSwwLDAsXCJcIikpe3QuYihcIlx0XHRcdDxpbWcgc3JjPVxcXCJcIik7dC5iKHQudih0LmQoXCJpbWFnZXMubG93X3Jlc29sdXRpb24udXJsXCIsYyxwLDApKSk7dC5iKFwiXFxcIiBhbHQ9XFxcIlwiKTt0LmIodC52KHQuZChcImNhcHRpb24udGV4dFwiLGMscCwwKSkpO3QuYihcIlxcXCIgLz5cIik7dC5iKFwiXFxuXCIgKyBpKTt9O2lmKHQucyh0LmYoXCJ2aWRlb3NcIixjLHAsMSksYyxwLDAsMTczLDI3OSxcInt7IH19XCIpKXt0LnJzKGMscCxmdW5jdGlvbihjLHAsdCl7dC5iKFwiXHRcdFx0PHZpZGVvIGF1dG9wbGF5IGxvb3A+XCIpO3QuYihcIlxcblwiICsgaSk7dC5iKFwiXHRcdFx0XHQ8c291cmNlIHNyYz1cXFwiXCIpO3QuYih0LnYodC5kKFwidmlkZW9zLmxvd19yZXNvbHV0aW9uLnVybFwiLGMscCwwKSkpO3QuYihcIlxcXCIgdHlwZT1cXFwidmlkZW8vbXA0XFxcIj5cIik7dC5iKFwiXFxuXCIgKyBpKTt0LmIoXCJcdFx0XHQ8L3ZpZGVvPlwiKTt0LmIoXCJcXG5cIiArIGkpO30pO2MucG9wKCk7fWlmKHQucyh0LmQoXCJjYXB0aW9uLnRleHRcIixjLHAsMSksYyxwLDAsMzEwLDM4MSxcInt7IH19XCIpKXt0LnJzKGMscCxmdW5jdGlvbihjLHAsdCl7dC5iKFwiXHRcdFx0PGRpdiBjbGFzcz1cXFwiaW5zdGFfaXRlbV9fY2FwdGlvblxcXCI+XCIpO3QuYihcIlxcblwiICsgaSk7dC5iKFwiXHRcdFx0XHRcIik7dC5iKHQudih0LmQoXCJjYXB0aW9uLnRleHRcIixjLHAsMCkpKTt0LmIoXCJcXG5cIiArIGkpO3QuYihcIlx0XHRcdDwvZGl2PlwiKTt0LmIoXCJcXG5cIiArIGkpO30pO2MucG9wKCk7fWlmKHQucyh0LmQoXCJsb2NhdGlvbi5uYW1lXCIsYyxwLDEpLGMscCwwLDQxOSw0OTIsXCJ7eyB9fVwiKSl7dC5ycyhjLHAsZnVuY3Rpb24oYyxwLHQpe3QuYihcIlx0XHRcdDxkaXYgY2xhc3M9XFxcImluc3RhX2l0ZW1fX2xvY2F0aW9uXFxcIj5cIik7dC5iKFwiXFxuXCIgKyBpKTt0LmIoXCJcdFx0XHRcdFwiKTt0LmIodC52KHQuZChcImxvY2F0aW9uLm5hbWVcIixjLHAsMCkpKTt0LmIoXCJcXG5cIiArIGkpO3QuYihcIlx0XHRcdDwvZGl2PlwiKTt0LmIoXCJcXG5cIiArIGkpO30pO2MucG9wKCk7fXQuYihcIlx0XHQ8aW1nIGNsYXNzPVxcXCJvdmVybGF5XFxcIiBzcmM9XFxcIm1hZ25pZmljZW50X2N1dHMuZ2lmXFxcIiAvPlwiKTt0LmIoXCJcXG5cIiArIGkpO3QuYihcIlx0PC9hPlwiKTt0LmIoXCJcXG5cIiArIGkpO3QuYihcIjwvZGl2PlwiKTtyZXR1cm4gdC5mbCgpOyB9LHBhcnRpYWxzOiB7fSwgc3ViczogeyAgfX0pO1xudGVtcGxhdGVzW1wiaXRlbVwiXSA9IG5ldyBIb2dhbi5UZW1wbGF0ZSh7Y29kZTogZnVuY3Rpb24gKGMscCxpKSB7IHZhciB0PXRoaXM7dC5iKGk9aXx8XCJcIik7dC5iKFwiPGRpdiBjbGFzcz1cXFwiaW5zdGFfaXRlbVxcXCI+XCIpO3QuYihcIlxcblwiICsgaSk7dC5iKFwiXHQ8YSBocmVmPVxcXCJcIik7dC5iKHQudih0LmYoXCJsaW5rXCIsYyxwLDApKSk7dC5iKFwiXFxcIiB0YXJnZXQ9XFxcIl9ibGFua1xcXCI+XCIpO3QuYihcIlxcblwiICsgaSk7aWYoIXQucyh0LmYoXCJ2aWRlb3NcIixjLHAsMSksYyxwLDEsMCwwLFwiXCIpKXt0LmIoXCJcdFx0XHQ8aW1nIHNyYz1cXFwiXCIpO3QuYih0LnYodC5kKFwiaW1hZ2VzLmxvd19yZXNvbHV0aW9uLnVybFwiLGMscCwwKSkpO3QuYihcIlxcXCIgYWx0PVxcXCJcIik7dC5iKHQudih0LmQoXCJjYXB0aW9uLnRleHRcIixjLHAsMCkpKTt0LmIoXCJcXFwiIC8+XCIpO3QuYihcIlxcblwiICsgaSk7fTtpZih0LnModC5mKFwidmlkZW9zXCIsYyxwLDEpLGMscCwwLDE3MywyNzksXCJ7eyB9fVwiKSl7dC5ycyhjLHAsZnVuY3Rpb24oYyxwLHQpe3QuYihcIlx0XHRcdDx2aWRlbyBhdXRvcGxheSBsb29wPlwiKTt0LmIoXCJcXG5cIiArIGkpO3QuYihcIlx0XHRcdFx0PHNvdXJjZSBzcmM9XFxcIlwiKTt0LmIodC52KHQuZChcInZpZGVvcy5sb3dfcmVzb2x1dGlvbi51cmxcIixjLHAsMCkpKTt0LmIoXCJcXFwiIHR5cGU9XFxcInZpZGVvL21wNFxcXCI+XCIpO3QuYihcIlxcblwiICsgaSk7dC5iKFwiXHRcdFx0PC92aWRlbz5cIik7dC5iKFwiXFxuXCIgKyBpKTt9KTtjLnBvcCgpO31pZih0LnModC5kKFwiY2FwdGlvbi50ZXh0XCIsYyxwLDEpLGMscCwwLDMxMCwzODEsXCJ7eyB9fVwiKSl7dC5ycyhjLHAsZnVuY3Rpb24oYyxwLHQpe3QuYihcIlx0XHRcdDxkaXYgY2xhc3M9XFxcImluc3RhX2l0ZW1fX2NhcHRpb25cXFwiPlwiKTt0LmIoXCJcXG5cIiArIGkpO3QuYihcIlx0XHRcdFx0XCIpO3QuYih0LnYodC5kKFwiY2FwdGlvbi50ZXh0XCIsYyxwLDApKSk7dC5iKFwiXFxuXCIgKyBpKTt0LmIoXCJcdFx0XHQ8L2Rpdj5cIik7dC5iKFwiXFxuXCIgKyBpKTt9KTtjLnBvcCgpO31pZih0LnModC5kKFwibG9jYXRpb24ubmFtZVwiLGMscCwxKSxjLHAsMCw0MTksNDkyLFwie3sgfX1cIikpe3QucnMoYyxwLGZ1bmN0aW9uKGMscCx0KXt0LmIoXCJcdFx0XHQ8ZGl2IGNsYXNzPVxcXCJpbnN0YV9pdGVtX19sb2NhdGlvblxcXCI+XCIpO3QuYihcIlxcblwiICsgaSk7dC5iKFwiXHRcdFx0XHRcIik7dC5iKHQudih0LmQoXCJsb2NhdGlvbi5uYW1lXCIsYyxwLDApKSk7dC5iKFwiXFxuXCIgKyBpKTt0LmIoXCJcdFx0XHQ8L2Rpdj5cIik7dC5iKFwiXFxuXCIgKyBpKTt9KTtjLnBvcCgpO310LmIoXCJcdFx0PGltZyBjbGFzcz1cXFwib3ZlcmxheVxcXCIgc3JjPVxcXCJtYWduaWZpY2VudF9jdXRzLmdpZlxcXCIgLz5cIik7dC5iKFwiXFxuXCIgKyBpKTt0LmIoXCJcdDwvYT5cIik7dC5iKFwiXFxuXCIgKyBpKTt0LmIoXCI8L2Rpdj5cIik7cmV0dXJuIHQuZmwoKTsgfSxwYXJ0aWFsczoge30sIHN1YnM6IHsgIH19KTtcbiIsInZhciBjbGllbnRJZCA9ICc3MzA0YzRkNTdlNmY0MmVkODVmMDFkNjBmZGE1MmEyYic7XG52YXIgYWNjZXNzVG9rZW4gPSAnMjA0OTQxNzUwNi43MzA0YzRkLjhmMzZkMGZjOThiYzRmNjg4ZTdhMTdmZWM0ZDcyOGJjJztcblxuJChmdW5jdGlvbigpe1xuXHR2YXIgZ2FsbGVyeSA9ICQoJyNnYWxsZXJ5Jyk7XG4gIGdldCgpLmRvbmUoZnVuY3Rpb24ocmVzcCl7XG4gIFx0JC5lYWNoKHJlc3AuZGF0YSxmdW5jdGlvbigpe1xuICBcdFx0Z2FsbGVyeS5hcHBlbmQodGVtcGxhdGVzLml0ZW0ucmVuZGVyKHRoaXMpKTtcbiAgXHR9KVxuICBcdCQoXCJ2aWRlb1wiKS5wcm9wKFwidm9sdW1lXCIsIDApO1xuICB9KTtcbn0pXG5cbnZhciBnZXQgPSBmdW5jdGlvbigpe1xuXHRyZXR1cm4gJC5hamF4KHtcblx0XHR0eXBlOiBcIkdFVFwiLFxuICAgICAgICBkYXRhVHlwZTogXCJqc29ucFwiLFxuICAgICAgICB1cmwgOiAnaHR0cHM6Ly9hcGkuaW5zdGFncmFtLmNvbS92MS91c2Vycy9zZWxmL21lZGlhL3JlY2VudD9hY2Nlc3NfdG9rZW49MjA0OTQxNzUwNi4xZmIyMzRmLjUzMjUzMjVmYzI0ZjQ2OGY4YTg2MjFjMWEzOWE1Y2UwJmNvdW50PTMwJ1xuXHR9KVxufVxuXG4iXSwic291cmNlUm9vdCI6Ii9zb3VyY2UvIn0=