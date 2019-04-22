/*
 * Tiny wee library to create SVG objects and generate the HTML to push into a browser
 * or save to an external svg document. If you need more advanced drawing features
 * check out a real library like paper.js
 */
 
function paramTemplate(params, optional) {
  return _(params).map(function(style, param) {
    var text = style + '="{{' + param + '}}"';
    if (optional) {
      text = '{{#if ' + param + '}}' + text + '{{/if}}';
    }
    return text;
  }).join(' ');
}
function styleTemplate(params) {
  return _(params).map(function(style, param) {
    return '{{#if ' + param + '}}' + style + ':{{' + param + '}}{{/if}}';
  }).join(';');
}

var objectParams = {
  display: 'display',
  opacity: 'opacity',
  visibility: 'visibility',
  style: 'style'
}
var fillParams = {
  fillColor: 'fill',
  fillOpacity: 'fill-opacity',
}
var strokeParams = {
  strokeColor: 'stroke',
  strokeDasharray: 'stroke-dasharray',
  strokeDashoffset: 'stroke-dashoffset',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  strokeMiterlimit: 'stroke-miterlimit',
  strokeOpacity: 'stroke-opacity',
  strokeWidth: 'stroke-width',
}

var svg = {
  FillRule: {
    NonZero: 'nonzero',
    EvenOdd: 'evenodd'
  },
  Linecap: {
    Butt: 'butt',
    Round: 'round',
    Square: 'square',
  },
  Linejoin: {
    Arcs: 'arcs',
    Bevel: 'bevel',
    Miter: 'miter',
    MiterClip: 'miter-clip',
    Round: 'round',
  },
}

svg.Document = class {
// ‘viewBox’
// ‘preserveAspectRatio’
// ‘zoomAndPan’
// ‘transform’
  constructor(params) {
    const defaults = {
      width: 400,
      height: 400,
      items: []
    }
    _.extend(this, defaults, params);
  }
  
  html() {
    var params = paramTemplate({width:'width',height:'height'});
    var optionalParams = {x:'x',y:'y'};
    var optionalParams = _.extend(objectParams, fillParams, strokeParams, optionalParams);
    optionalParams = paramTemplate(optionalParams, true);
    var template = '<svg xmlns:svg="http://www.w3.org/2000/svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' + [params, optionalParams].join(' ') + '>';
    var items = _(this.items).map(function(item) {
      return item.html();
    });
    return Handlebars.compile(template)(this) + items.join('') + '</svg>';
  }
}

svg.Group = class {
  constructor(params) {
    const defaults = {
      items: []
    }
    _.extend(this, defaults, params);
  }
  html() {
    var optionalParams = _.extend(objectParams, fillParams, strokeParams);
    optionalParams = paramTemplate(optionalParams, true);
    var template = '<g ' + optionalParams + '>';
    var items = _(this.items).map(function(item) {
      return item.html();
    });
    return Handlebars.compile(template)(this) + items.join('') + '</g>';
  }
}

svg.Rectangle = class {
  constructor(params) {
    const defaults = {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    }
    _.extend(this, defaults, params);
  }
  
  html() {
    var params = paramTemplate({x:'x',y:'y',width:'width',height:'height'});
    var optionalParams = _.extend(objectParams, fillParams, strokeParams, {rx:'rx',ry:'ry'});
    optionalParams = paramTemplate(optionalParams, true);
    var template = '<rect ' + [params, optionalParams].join(' ') + '></rect>';
    return Handlebars.compile(template)(this);
  }
  
  toPath() {
    var rx = Math.min(this.rx || 0, this.width/2);
    var ry = Math.min(this.ry || 0, this.height/2);
    if (!_(this).has('rx')) {
      if (!_(this).has('ry')) {
        rx = 0;
        ry = 0;
      } else {
        rx = ry;
      }
    } else if (!_(this).has('ry')) {
      ry = rx;
    }
      
    var d = [];
    d.push('M' + [this.x+rx,this.y].join(' '));
    d.push('H' + (this.x+this.width-rx));
    if (rx > 0 && ry > 0) {
      d.push('A' + [rx,ry,0,0,1,this.x+this.width,this.y+ry].join(' '));
    }
    d.push('V' + (this.y+this.height-ry));
    if (rx > 0 && ry > 0) {
      d.push('A' + [rx,ry,0,0,1,this.x+this.width-rx,this.y+this.height].join(' '));
    }
    d.push('H' + (this.x+rx));
    if (rx > 0 && ry > 0) {
      d.push('A' + [rx,ry,0,0,1,this.x,this.y+this.height-ry].join(' '));
    }
    d.push('V' + (this.y+ry));
    if (rx > 0 && ry > 0) {
      d.push('A' + [rx,ry,0,0,1,this.x+rx,this.y].join(' '));
    }
    d.push('Z');
    return new svg.Path({d:d});
  }
}

svg.Circle = class {
  constructor(params) {
    const defaults = {
      cx: 0,
      cy: 0,
      r: 100,
    }
    _.extend(this, defaults, params);
  }
  
  html() {
    var params = paramTemplate({cx:'cx',cy:'cy',r:'r'});
    var optionalParams = _.extend(objectParams, fillParams, strokeParams);
    optionalParams = paramTemplate(optionalParams, true);
    var template = '<circle ' + [params, optionalParams].join(' ') + '></circle>';
    return Handlebars.compile(template)(this);
  }
  
  toPath() {
    var d = [];
    d.push('M' + [this.cx+this.r,this.cy].join(' '));
    var arcs = [
      [this.cx,this.cy+this.r],
      [this.cx-this.r,this.cy],
      [this.cx,this.cy-this.r],
      [this.cx+this.r,this.cy]
    ];
    _(arcs).each(function(coord) {
      d.push('A' + [this.r,this.r,0,0,1,coord[0],coord[1]].join(' '));
    }, this);
    d.push('Z');
    return new svg.Path({d:d});
  }
}

svg.Ellipse = class {
  constructor(params) {
    const defaults = {
      cx: 0,
      cy: 0,
      rx: 100,
      ry: 100,
    }
    _.extend(this, defaults, params);
  }
  
  html() {
    var params = paramTemplate({cx:'cx',cy:'cy',rx:'rx',ry:'ry'});
    var optionalParams = _.extend(objectParams, fillParams, strokeParams);
    optionalParams = paramTemplate(optionalParams, true);
    var template = '<ellipse ' + [params, optionalParams].join(' ') + '></ellipse>';
    return Handlebars.compile(template)(this);
  }

  toPath() {
    var d = [];
    d.push('M' + [this.cx+this.rx,this.cy].join(' '));
    var arcs = [
      [this.cx,this.cy+this.ry],
      [this.cx-this.rx,this.cy],
      [this.cx,this.cy-this.ry],
      [this.cx+this.rx,this.cy]
    ];
    _(arcs).each(function(coord) {
      d.push('A' + [this.rx,this.ry,0,0,1,coord[0],coord[1]].join(' '));
    }, this);
    d.push('Z');
    return new svg.Path({d:d});
  }
}

svg.Line = class {
  constructor(params) {
    const defaults = {
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 100,
    }
    _.extend(this, defaults, params);
  }
  
  html() {
    var params = paramTemplate({x1:'x1',y1:'y1',x2:'x2',y2:'y2'});
    var optionalParams = _.extend(objectParams, strokeParams);
    optionalParams = paramTemplate(optionalParams, true);
    var template = '<line ' + [params, optionalParams].join(' ') + '></line>';
    return Handlebars.compile(template)(this);
  }

  toPath() {
    var d = [];
    d.push('M' + [this.x1,this.y1].join(' '));
    d.push('L' + [this.x2,this.y2].join(' '));
    return new svg.Path({d:d});
  }
}

svg.Polygon = class {
  constructor(params) {
    const defaults = {
      points: [],
    }
    _.extend(this, defaults, params);
  }
  
  html() {
    var optionalParams = _.extend(objectParams, fillParams, strokeParams, {fillRule:'fill-rule'});
    optionalParams = paramTemplate(optionalParams, true);
    var template = '<polygon points="{{#each points}}{{this.[0]}},{{this.[1]}} {{/each}}" ' + optionalParams + '></polygon>';
    return Handlebars.compile(template)(this);
  }

  toPath() {
    var d = [];
    for(var i = 0; i < this.points.length; i++) {
      var op = i == 0 ? 'M' : 'L';
      d.push(op + [this.points[i][0],this.points[i][1]].join(' '));
    }
    if (this.points.length) {
      d.push('Z');
    }
    return new svg.Path({d:d});
  }
}

svg.Polyline = class {
  constructor(params) {
    const defaults = {
      points: [],
    }
    _.extend(this, defaults, params);
  }
  
  html() {
    var optionalParams = _.extend(objectParams, fillParams, strokeParams);
    optionalParams = paramTemplate(optionalParams, true);
    var template = '<polyline points="{{#each points}}{{this.[0]}},{{this.[1]}} {{/each}}" ' + optionalParams + '></polyline>';
    return Handlebars.compile(template)(this);
  }
  
  toPath() {
    var d = [];
    for(var i = 0; i < this.points.length; i++) {
      var op = i == 0 ? 'M' : 'L';
      d.push(op + [this.points[i][0],this.points[i][1]].join(' '));
    }
    return new svg.Path({d:d});
  }
}

svg.Path = class {
  constructor(params) {
    const defaults = {
      d: [],
    }
    _.extend(this, defaults, params);
  }
  
  html() {
    var params = 'd="{{#each d}}{{{this}}}{{/each}}"';
    var optionalParams = _.extend(objectParams, fillParams, strokeParams);
    optionalParams = paramTemplate(optionalParams, true);
    var template = '<path ' + [params, optionalParams].join(' ') + '></path>';
    return Handlebars.compile(template)(this);
  }
  
  toPath() {
    return this;
  }
  
  translate(x, y = 0) {
    this.d = _(this.d).map(function(cmd) {
      var cmdType = cmd[0];
      var params = _(_(cmd.substr(1).split(' '))).map(function(param) {
        return parseFloat(param);
      });
      switch(cmdType) {
        case 'M': // MoveTo
        case 'L': // LineTo
        case 'C': // Cubic Bézier Curve
        case 'S': // Smooth Cubic Bézier Curve
        case 'Q': // Quadratic Bézier Curve
        case 'T': // Smooth Quadratic Bézier Curve
          for(var i = 0; i < params.length; i += 2) {
            params[i] += x;
            params[i+1] += y;
          }
          return cmdType + params.join(' ');
        case 'H': // Horizontal LineTo
          params[0] += x;
          return cmdType + params.join(' ');
        case 'V': // Vertical LineTo
          params[0] += y;
          return cmdType + params.join(' ');
        case 'A': // Elliptical Arc Curve
          params[5] += x;
          params[6] += y;
          return cmdType + params.join(' ');
        default:
          return cmd;
      }
    });
  }
}

svg.Path.parsePathData = function(command) {
  var regx = /[MLCSQTHVAmlcsqthva](-?\d*(\.\d+)?[\ \,]?)*/g;
  return _(command.match(regx)).map(function(c) {
    return c.replace(',', ' ');
  });
}

svg.Text = class {
  constructor(params) {
    const defaults = {
      x: 0,
      y: 0,
      text: ''
    }
    _.extend(this, defaults, params);
  }

  html() {
    var params = paramTemplate({x:'x',y:'y'});
    var optionalParams = {dx:'dx',dy:'dy',rotate:'rotate',lengthAdjust:'lengthAdjust',textLength:'textLength', textAnchor:'text-anchor'};
    optionalParams = _.extend(objectParams, optionalParams);
    optionalParams = paramTemplate(optionalParams, true);
    var template = '<text ' + [params, optionalParams].join(' ') + '>{{text}}</text>';
    return Handlebars.compile(template)(this);
  }
}

svg.Image = class {
  constructor(params) {
    const defaults = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      url: '',
      preserveAspectRatio: 'none'
    }
    _.extend(this, defaults, params);
  }

  html() {
    var params = paramTemplate({x:'x',y:'y',width:'width',height:'height',url:'xlink:href', preserveAspectRatio: 'preserveAspectRatio'});
    var template = '<image ' + [params].join(' ') + '></image>';
    return Handlebars.compile(template)(this);
  }
}

// TODO: tspan, textPath

