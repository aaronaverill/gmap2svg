var ppi = 96; // Points per inch
var corsProxyUrl  = 'https://cors-anywhere.herokuapp.com/';
var textVerticalCenterOffset = 0.4;

LocalStorage = {
  getItem: function(key) {
    return window.localStorage ? window.localStorage.getItem(key) : null;
  },
  setItem: function(key, value) {
    return window.localStorage ? window.localStorage.setItem(key, value) : null;
  }
}

ErrorDialog = {
  show: function(title, message, okText = null, onOk = null) {
    var html = Handlebars.compile($('#error-modal').html())({
      title: title,
      message: message,
      okText: okText
    });
    var $modal = $(html);
    $modal.on('hidden.bs.modal', function () {
      $modal.modal('dispose');
      $modal.remove();
      if (onOk) onOk();
    });
    $modal.modal();
  }
}

SelectMapDialog = class {
  constructor(options) {
    var me = this;
    var recent = LocalStorage.getItem('recentMaps');
    if (!recent) recent = '[]';
    recent = JSON.parse(recent);
    var lastUrl = recent.length ? recent[0].url : '';
    var html = Handlebars.compile($('#open-map-modal').html())({
      lastUrl: lastUrl,
      recent: recent
    });
    var $modal = $(html);
    this.$modal = $modal;
    $modal.on('shown.bs.modal', function () {
      $('#map-url').trigger('focus');
      $('#map-url').select();
    });
    $modal.on('hidden.bs.modal', function () {
      me.mapUrl = $('#map-url').val();
      $modal.modal('dispose');
      $modal.remove();
      if (options.onClose) options.onClose(me);
    });
    $modal.modal({show:false});
    $('.recent-maps a', $modal).click(function(event) {
      event.preventDefault();
      $('#map-url').val($(this).data('url'));
      $modal.modal('hide');
    });
  }
  
  open() {
    this.$modal.modal('show');
  }
  
  closeDialog() {
    this.$modal.modal('hide');
    this.$modal.modal('dispose');
    this.$modal.remove();
    if (this.options.onClose) this.options.onClose(this);
  }
}

KmlParser = {
  /** 
   * Extract a text node and clean it up.
   * Adobe Illustrator can't handle &nbsp; in SVG file. Convert to space.
   * Why so picky Adobe?
   */
  cleanTextNodeValue: function(node) {
    return node[0].childNodes[0].nodeValue.trim().replace(/\u00a0/g, ' ');
  },
  /**
   * Follow the style ID to get the actual style node in the KML document.
   */
  getStyleByUrl: function(kmlDoc, styleUrl) {
    if (!styleUrl.length || styleUrl[0] != '#') return null;
    return kmlDoc.getElementById(styleUrl.substr(1));
  },
  /**
   * Parse KML color info into an opacity, RGB pair.
   */
  getRgba: function(colorNode) {
    var color = colorNode.childNodes[0].nodeValue;
    return [
      parseInt(color.substr(6, 2), 16) / 256,
      parseInt(color.substr(4, 2), 16) / 256,
      parseInt(color.substr(2, 2), 16) / 256,
      parseInt(color.substr(0, 2), 16) / 256
    ]
  },
  /**
   * Parse KML coordinate text into an array of [lat,lng] float pairs.
   */
  getCoordinateData: function(coordinatesNode) {
    if (!coordinatesNode) return [];
    return _(coordinatesNode.childNodes[0].nodeValue.trim().split('\n')).map(function(coordinate) {
      // Kml coordinates are longitude, latitude, flip and parse into float [lat,lng]
      coordinate = coordinate.trim().split(',');
      return _([coordinate[1], coordinate[0]]).map(function(c) {
        return parseFloat(c);
      });
    });
  },
  /**
   * Get a node child by path. Like a really cheap and dirty version of XPath, lol.
   */
  getSubNode: function(node, path) {
    return _(path.split('/')).reduce(function(ele, part) {
      if (!ele) return null;
      var child = ele.getElementsByTagName(part);
      return child.length ? child[0] : null;
    }, node);
  },
  /**
   * Parse the KML document into a structure of things we care about that is actually useful.
   * Basically, this creates a document that has an array of folders, each folder has a name
   * and an array of placemarks, each placemark has a name and some geography features 
   * such as a polygon, line, or icon. While parsing unravel all the linked style information and 
   * attach it to the placemark features.
   */
  parse: function(kmlDoc) {
    var data = {};
    var doc = kmlDoc.documentElement.getElementsByTagName('Document')[0];
    data.title = KmlParser.cleanTextNodeValue(doc.getElementsByTagName('name'));
    data.folders = _(doc.getElementsByTagName('Folder')).map(function(kmlFolder) {
      var folder = {};
      folder.name = KmlParser.cleanTextNodeValue(kmlFolder.getElementsByTagName('name'));
      folder.placemarks = _(kmlFolder.getElementsByTagName('Placemark')).map(function(kmlPlacemark) {
        var placemark = {
          name: KmlParser.cleanTextNodeValue(kmlPlacemark.getElementsByTagName('name')),
          style: {}
        };
        
        // Read the style information
        var styleUrl = kmlPlacemark.getElementsByTagName('styleUrl')[0].childNodes[0].nodeValue;
        var style = KmlParser.getStyleByUrl(kmlDoc, styleUrl);
        // If it's a style map element, get the normal style
        if (style && style.tagName == 'StyleMap') {
          var normalPair = _(style.getElementsByTagName('Pair')).find(function(pair) {
            var key = pair.getElementsByTagName('key')[0].childNodes[0].nodeValue;
            return key == 'normal';
          });
          if (normalPair) {
            styleUrl = normalPair.getElementsByTagName('styleUrl')[0].childNodes[0].nodeValue;
            style = KmlParser.getStyleByUrl(kmlDoc, styleUrl);
          } else {
            style = null;
          }
        }
        // Extract the style info
        if (style) {
          var lineStyle = style.getElementsByTagName('LineStyle')[0];
          if (lineStyle) {
            placemark.style.strokeColor = KmlParser.getRgba(lineStyle.getElementsByTagName('color')[0]);
            placemark.style.strokeWidth = parseFloat(lineStyle.getElementsByTagName('width')[0].childNodes[0].nodeValue);
          }
          var polyStyle = style.getElementsByTagName('PolyStyle')[0];
          if (polyStyle) {
            placemark.style.fillColor = KmlParser.getRgba(polyStyle.getElementsByTagName('color')[0]);
          }
          var iconStyle = style.getElementsByTagName('IconStyle')[0];
          if (iconStyle) {
            var scale = parseFloat(iconStyle.getElementsByTagName('scale')[0].childNodes[0].nodeValue);
            var icon = iconStyle.getElementsByTagName('Icon')[0];
            if (icon) {
              var href = icon.getElementsByTagName('href')[0].childNodes[0].nodeValue;
              placemark.icon = {
                scale: scale,
                href: href
              }
            }
          }
        }
        
        // Polygon
        var polygon = KmlParser.getCoordinateData(KmlParser.getSubNode(kmlPlacemark, 'Polygon/outerBoundaryIs/LinearRing/coordinates'));
        if (polygon.length) {
          placemark.polygon = {
            coordinates: polygon
          }
        }
        
        // LineString
        var lineString = KmlParser.getCoordinateData(KmlParser.getSubNode(kmlPlacemark, 'LineString/coordinates'));
        if (lineString.length) {
          placemark.lineString = {
            coordinates: lineString
          }
        }
        
        // Point
        var point = KmlParser.getCoordinateData(KmlParser.getSubNode(kmlPlacemark, 'Point/coordinates'));
        if (point.length) {
          placemark.point = {
            coordinate: point[0]
          }
        }
        return placemark;
      });
      return folder;
    });
    return data;
  }
}

Geo = {
  /**
   * Return north, south, east, west coordinates and center point that bound the coordinate pairs [lat, lon]
   */
  getBoundingBox: function(coordinates) {
    if (!coordinates.length) return null;
    
    var corners = {
      south: null,
      north: null,
      west: null,
      east: null,
      westFlip: null,
      eastFlip: null
    }
    
    _(coordinates).each(function(point) {
      corners.south = corners.south == null ? point[0] : point[0] < corners.south ? point[0] : corners.south;
      corners.north = corners.north == null ? point[0] : point[0] > corners.north ? point[0] : corners.north;
      corners.west = corners.west == null ? point[1] : point[1] < corners.west ? point[1] : corners.west;
      corners.east = corners.east == null ? point[1] : point[1] > corners.east ? point[1] : corners.east;
      var longitude = point[1] < 0 ? point[1] + 360 : point[1];
      corners.westFlip = corners.westFlip == null ? longitude : longitude < corners.westFlip ? longitude : corners.westFlip;
      corners.eastFlip = corners.eastFlip == null ? longitude : longitude > corners.eastFlip ? longitude : corners.eastFlip;
    });
    var bounds = {
      south: corners.south,
      north: corners.north,
      west: corners.west,
      east: corners.east,
    }
    if (corners.east - corners.west > corners.eastFlip - corners.westFlip) {
      corners.west = corners.westFlip;
      corners.east = corners.eastFlip;
      _(['west', 'east']).each(function(compass) {
        if (corners[compass] > 180) corners[compass] -= 360;
      });
    }
    bounds.center = [(bounds.south + bounds.north) / 2, (bounds.east + bounds.west) / 2];
    return bounds;
  },
  /**
   * Convert a [lat,lng] pair into a global X,Y pair that matches the Google Maps projection system.
   * X values > 0 and increase from west to east. Y values > 0 and increase from north to south.
   */
  coordinateToPoint: function(coordinate) {
    var x = (coordinate[1] + 180) / 360 * 256;
    var y = ((1 - Math.log(Math.tan(coordinate[0] * Math.PI / 180) + 1 / Math.cos(coordinate[0] * Math.PI / 180)) / Math.PI) / 2) * 256;
    return [x, y];
  },
  /**
   * Return the distance between two points in meters
   */
  measureDistance: function(coord1, coord2) {
    var radlat1 = Math.PI * coord1[0]/180;
    var radlat2 = Math.PI * coord2[0]/180;
    var theta = coord1[1]-coord2[1];
    var radtheta = Math.PI * theta/180;
    var dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
    dist = Math.min(1, dist);
    dist = Math.acos(dist);
    dist = dist * 180/Math.PI;
    dist = dist * 111189.57696;
    return dist;
  },
  /**
   * Convert a floating point meters into a feet+inches label such as 11'9"
   */
  metersToFeetInches: function(meters) {
    var feet = Math.floor(meters);
    var inch = Math.round((meters - feet)*12);
    if (inch >= 12) {
      feet++;
      inch -= 12;
    }
    return feet + '\'' + inch + '"';
  }
}

var defaultDisplayOptions = {
  page: {
    orientation: 'portrait',
    width: 8.5,
    height: 11,
    margin: .25,
    backgroundColor: '#B3DBA2', // Light green "grass"
  },
  shapes: {
    lineStyle: 'map',
    lineColor: '#000000',
    fillStyle: 'map',
    fillColor: '#000000',
  },
  icons: {
    show: true,
  },
  placeLabels: {
    show: true,
    style: 'flag',
    color: '#000000',
    fontSize: 7,
    fontFamily: 'Arial',
    fontWeight: 'normal',
    // TODO: flagLength: 30
    flagDirection: 'aboveright',
    flagColor: '#000000',
    flagAnchorShape: 'circle',
    flagAnchorSize: 4,
  },
  measurements: {
    show: false,
    color: '#000000',
    fontSize: 4,
    fontFamily: 'Arial',
    fontWeight: 'normal',
  },
  folders: []
}

App = class {
  constructor() {
    var me = this;
    me.kmlData = null;
    me.pageZoom = 1;
    me.activePage = 'map';
    me.activeFolderIndex = 0;
    this.loadDisplayOptions();
    
    // Navigation
    $('.display-options').on('click', '.settings-page.folder-settings .btn.folder-back', function(event) {
      me.activePage = 'map';
      me.refreshDisplayOptions();
    });
    // Generic controls handled via data properties
    $('.display-options').on('input', 'input', function(event) {
      me.handleDisplayOptionChange(event);
    });
    $('.display-options').on('change', 'select', function(event) {
      me.handleDisplayOptionChange(event);
    });
    $('.display-options').on('change', 'select[data-property="page.orientation"]', function(event) {
      $('.row.page-orientation-custom-fields').toggle($(this).val() == 'custom');
    });
    $('.display-options').on('click', '.color-button', function(event) {
      me.handleColorButtonClick(event);
    });
    $('.display-options').on('change', '.field-section.with-checkbox input[type="checkbox"]', function(event) {
      me.handleSectionShowChange(event);
    });
    
    // Shapes section
    $('.display-options').on('change', 'select[data-property="shapes.lineStyle"]', function(event) {
      var style = $(this).val();
      $('.row.shapes-lineStyle-fields').toggle(style == 'custom');
    });
    $('.display-options').on('change', 'select[data-property="shapes.fillStyle"]', function(event) {
      var style = $(this).val();
      $('.row.shapes-fillStyle-fields').toggle(style == 'custom');
    });
    
    // Place labels section
    $('.display-options').on('change', 'select[data-property="placeLabels.style"]', function(event) {
      var style = $(this).val();
      $('.row.placeLabels-style-flag-fields').toggle(style == 'flag');
    });
    
    // Layers section
    $('.display-options').on('change', 'input.folder-show', function(event) {
      var $checkbox = $(this);
      var $folderGroup = $checkbox.closest('fieldset');
      var folderIndex = $folderGroup.data('index');
      var show = $checkbox.is(':checked');
      me.displayOptions.folders[folderIndex].show = show;
      me.updateCanvas();
      me.saveDisplayOptions();
      $('.container.fields', $folderGroup).toggle(show);
    });
    
    // Folder options
    $('.display-options').on('click', '.folder-list fieldset.folder .btn.folder-options', function(event) {
      me.handleShowFolderOptionsClick(event);
    });
    
    // Folder places section
    $('.display-options').on('change', 'input.place-show', function(event) {
      var $checkbox = $(this);
      var $placeGroup = $checkbox.closest('fieldset');
      var placeIndex = $placeGroup.data('index');
      var show = $checkbox.is(':checked');
      me.displayOptions.folders[me.activeFolderIndex].places[placeIndex].show = show;
      me.updateCanvas();
      me.saveDisplayOptions();
      $('.container.fields', $placeGroup).toggle(show);
    });
  }
  
  handleDisplayOptionChange(event) {
    var $input = $(event.currentTarget);
    var property = $input.data('property');
    if (!property) return;
    var propertyPath = property.split('.');
    property = propertyPath.pop();
    
    var value = $input.val();
    var type = $input.data('type');
    switch (type) {
      case 'float':
        value = parseFloat(value);
        break;
    }
    this.setDisplayOption(propertyPath, property, value);
  }
  
  handleColorButtonClick(event) {
    var $button = $(event.currentTarget);
    var property = $button.data('property');
    if (!property) return;
    var propertyPath = property.split('.');
    property = propertyPath.pop();
    
    var value = $button.data('value');
    this.setDisplayOption(propertyPath, property, value);
    $('input[data-property="' + $button.data('property') + '"]').val(value);
  }
  
  handleSectionShowChange(event) {
    var $checkbox = $(event.currentTarget);
    var group = $checkbox.data('group');
    if (!group) return;
    var show = $checkbox.is(':checked');
    this.setDisplayOption([group], 'show', show);
    $('fieldset.' + group + ' .container.fields').toggle(show);
  }
  
  handleShowFolderOptionsClick(event) {
    var $button = $(event.currentTarget);
    var $folderGroup = $button.closest('fieldset');
    this.activePage = 'folder';
    this.activeFolderIndex = $folderGroup.data('index');
    this.refreshDisplayOptions();
  }
  
  zoomIn() {
    this.pageZoom *= 1.1;
    this.updateCanvas();
  }
  
  zoomOut() {
    this.pageZoom /= 1.1;
    this.updateCanvas();
  }
  
  setDisplayOption(propertyPath, property, value) {
    var object = this.displayOptions;
    _(propertyPath).each(function(p) {
      object = object[p];
    });
    if (object[property] != value) {
      object[property] = value;
      this.updateCanvas();
      this.saveDisplayOptions();
    }
  }
  
  /**
   * Show the dialog to open a Google Map URL.
   */
  selectMap() {
    var me = this;
    var dialog = new SelectMapDialog({
      onClose: function(dialog) {
        var mapUrl = dialog.mapUrl;
        if (mapUrl.length) {
          me.fetchMap(mapUrl);
        } else if (!me.kmlData) {
          me.selectMap();
        }
      }
    });
    dialog.open();
  }
  
  /**
   * Asynchronously fetch the KML data from a Google My Maps URL and call success or error function when complete.
   * Uses cors-anywhere to get around CORS issues in browser scripting. El Lameo. 
   */
  fetchMap(gmapUrl) {
    var me = this;
    $('.svg-wrapper .loading-spinner').show();
    
    setTimeout(function() {
      try {
        try {
          var url = new URL(gmapUrl);
        } catch (error) {
          throw 'Invalid Google Map URL';
        }
        var mid = url.searchParams.get('mid');
        if (!mid) {
          throw "Can't get Google Map ID";
        }
        url = 'https://www.google.com/maps/d/u/0/kml?mid=' + mid + '&forcekml=1';  
        url = corsProxyUrl + url;
        
        $.ajax(url, {
          success: function (kmlDoc, status, xhr) {
            $('.svg-wrapper .loading-spinner').hide();
            me.handleMapLoad(gmapUrl, mid, kmlDoc, status, xhr);
          },
          error: function(qXHR, textStatus) {
            $('.svg-wrapper .loading-spinner').hide();
            ErrorDialog.show("Couldn't load map", textStatus, 'Close', function() {
              if (!me.kmlData) me.selectMap();
            });
          }
        });
      } catch (err) {
        $('.svg-wrapper .loading-spinner').hide();
        ErrorDialog.show("Couldn't load map", err, 'Close', function() {
          if (!me.kmlData) me.selectMap();
        });
      }
    }, 50);
  }
  
  handleMapLoad(gmapUrl, mid, kmlDoc, status, xhr) {
    var me = this;
    me.pageZoom = 1;
    me.activePage = 'map';
    try {
      // Parse the KML document
      me.kmlData = KmlParser.parse(kmlDoc);
      me.kmlData.url = gmapUrl;
      me.kmlData.mid = mid;
      // Save the opened map in the recent list.
      var recent = LocalStorage.getItem('recentMaps');
      if (!recent) recent = '[]';
      recent = JSON.parse(recent);
      recent = _(recent).reject({url: gmapUrl});
      recent.unshift({
        name: me.kmlData.title,
        mid: mid,
        url: gmapUrl
      });
      recent = recent.slice(0, 5);
      LocalStorage.setItem('recentMaps', JSON.stringify(recent));
      
      // Load saved display settings for this map
      me.loadDisplayOptions();
      
      // Convert the map to SVG
      me.updateCanvas();
      // Update the settings
      me.refreshDisplayOptions();
      // Save the settings
      me.saveDisplayOptions();
      
      if (history.pushState) {
        history.pushState(null, null, '?mid=' + mid);
      }
    } catch (err) {
      ErrorDialog.show("Couldn't load map", err, 'Close', function() {
        if (!me.kmlData) me.selectMap();
      });
    }
  }
  
  updateCanvas() {
    var pageOptions = this.displayOptions.page;
    var shapeOptions = this.displayOptions.shapes;
    var placeLabelOptions = this.displayOptions.placeLabels;
    var measurementOptions = this.displayOptions.measurements;
    var folderOptions = this.displayOptions.folders;
    
    // Copy the data and display options
    var data = $.extend(true, {}, this.kmlData);
    _(data.folders).filter(function(folder, fIndex) {
      folder.placemarks = _(folder.placemarks).filter(function(placemark, pIndex) {
        return folderOptions[fIndex].places[pIndex].show;
      });
    });
    data.folders = _(data.folders).filter(function(folder, index) {
      return folderOptions[index].show;
    });
    
    // Calculate the coordinate boundaries
    var coordinates = [];
    _(data.folders).each(function(folder) {
      _(folder.placemarks).each(function(placemark) {
        placemark.allCoordinates = [];
        _(['polygon', 'lineString']).each(function(type) {
          if (placemark[type]) {
            placemark.allCoordinates = placemark.allCoordinates.concat(placemark[type].coordinates);
          }
        });
        if (placemark.point) {
          placemark.allCoordinates.push(placemark.point.coordinate);
        }
        placemark.bounds = Geo.getBoundingBox(placemark.allCoordinates);
        coordinates = coordinates.concat(placemark.allCoordinates);
      });
    });
    var bounds = Geo.getBoundingBox(coordinates);
    
    // Create the paper object on the canvas
    var canvas = document.getElementById('svg-canvas');
    var $canvas = $(canvas);
    
    var pageSize = [
      pageOptions.width*ppi,
      pageOptions.height*ppi
    ]
    if (pageOptions.orientation == 'portrait') {
      pageSize = [8.5*ppi, 11*ppi];
    } else if (pageOptions.orientation == 'landscape') {
      pageSize = [11*ppi, 8.5*ppi];
    }
    var pageMargin = [
      pageOptions.margin*ppi,
      pageOptions.margin*ppi
    ]
    
    var canvasSize = _(pageSize).map(function(length) {
      return length*this.pageZoom;
    }, this);

    $canvas.css('width', canvasSize[0] + 'px');
    $canvas.css('height', canvasSize[1] + 'px');
    $canvas.addClass('loaded');
    paper.setup(canvas);
    paper.view.scale(this.pageZoom, new paper.Point(0, 0));

    // Create the background color
    if (pageOptions.backgroundColor != '#FFFFFF') {
      new paper.Shape.Rectangle({
        point: [0, 0],
        size: pageSize,
        fillColor: pageOptions.backgroundColor
      });
    }
    // If there's nothing to draw return an empty canvas
    if (!bounds) {
      paper.view.draw();
      return;
    }
    
    // Create the top level groups
    var topGroups = {
      polygons: new paper.Group({name: 'polygons'}),
      icons: new paper.Group({name: 'icons'}),
      labels: new paper.Group({name: 'labels'})
    };
    
    // Calculate the top left corner coordinates and aspect ratio
    var topLeftXY = Geo.coordinateToPoint([bounds.north, bounds.west]);
    var bottomRightXY = Geo.coordinateToPoint([bounds.south, bounds.east]);
    var size = [bottomRightXY[0] - topLeftXY[0], bottomRightXY[1] - topLeftXY[1]];
    var aspect = _([0,1]).map(function(index) {
      return (pageSize[index] - (pageMargin[index] * 2)) / size[index];
    });
    aspect = Math.min(aspect[0], aspect[1]);
    
    // Iterate through each folder
    _(data.folders).each(function(folder, fIndex) {
      var folderId = 'folder-' + this.nameToId(folder.name) + '-' + fIndex;
      
      var folderItems = {};
      _(topGroups).each(function(group, type) {
        folderItems[type] = [];
      });
      
      // Iterate through each placemark in the folder
      _(folder.placemarks).each(function(placemark, pIndex) {
        if (!placemark.bounds) return;
        
        // Create polylines
        if (placemark.lineString) {
          var points = _(placemark.lineString.coordinates).map(function(coordinate) {
            return this.coordinateToPageXY(coordinate, topLeftXY, aspect, pageMargin);
          }, this);
          
          var options = _.extend({segments: points, closed: false}, 
            placemark.style, {fillColor: 'transparent', strokeCap: 'round', strokeJoin: 'round'});

          folderItems.polygons.push(new paper.Path(options));
        }
        
        // Create polygons
        if (placemark.polygon) {
          var points = _(placemark.polygon.coordinates).map(function(coordinate) {
            return this.coordinateToPageXY(coordinate, topLeftXY, aspect, pageMargin);
          }, this);
          
          var options = _.extend({segments: points, closed: true}, placemark.style);
          switch (shapeOptions.lineStyle) {
            case 'none':
              delete options.strokeColor;
              delete options.strokeWidth;
              break;
            case 'custom':
              var lineColor = shapeOptions.lineColor.slice(1);
              options.strokeColor = [
                parseInt(lineColor.substr(0, 2), 16) / 256,
                parseInt(lineColor.substr(2, 2), 16) / 256,
                parseInt(lineColor.substr(4, 2), 16) / 256,
                options.strokeColor[3]
              ]
              break;
          }
          switch (shapeOptions.fillStyle) {
            case 'none':
              delete options.fillColor;
              break;
            case 'custom':
              var fillColor = shapeOptions.fillColor.slice(1);
              options.fillColor = [
                parseInt(fillColor.substr(0, 2), 16) / 256,
                parseInt(fillColor.substr(2, 2), 16) / 256,
                parseInt(fillColor.substr(4, 2), 16) / 256,
                options.fillColor[3]
              ]
              break;
          }
          
          folderItems.polygons.push(new paper.Path(options));
        }
        
        // Create icons
        if (this.displayOptions.icons.show && placemark.point && placemark.icon) {
          var point = this.coordinateToPageXY(placemark.point.coordinate, topLeftXY, aspect, pageMargin);
          
          var raster = new paper.Raster({
            crossOrigin: 'anonymous',
            source: corsProxyUrl + placemark.icon.href,
            position: point,
            scale: placemark.icon.scale
          });
          
          folderItems.icons.push(raster);
        }
        
        // Create measurement labels
        if (measurementOptions.show && placemark.polygon) {
          // Measure distances
          var measurementLabels = [];
          var lastCoordinate = null;
          _(placemark.polygon.coordinates).each(function(coordinate) {
            if (lastCoordinate) {
              var center = [
                (coordinate[0] + lastCoordinate[0])/2,
                (coordinate[1] + lastCoordinate[1])/2
              ]
              var center = this.coordinateToPageXY(center, topLeftXY, aspect, pageMargin);
              var distance = Geo.measureDistance(lastCoordinate, coordinate);
              var label = Geo.metersToFeetInches(distance);
              
              measurementLabels.push({
                point: [center[0], center[1] + placeLabelOptions.fontSize*textVerticalCenterOffset],
                content: label,
                justification: 'center',
                fillColor: measurementOptions.color,
                fontSize: measurementOptions.fontSize,
                fontFamily: measurementOptions.fontFamily,
                fontWeight: measurementOptions.fontWeight,
              });
            }
            lastCoordinate = coordinate;
          }, this);
          if (measurementLabels.length) {
            var labelItems = _(measurementLabels).map(function(measurementLabel) {
              return new paper.PointText(measurementLabel);
            });
            folderItems.labels.push(new paper.Group(labelItems));
          }
        }
        
        // Create place labels
        if (placeLabelOptions.show) {
          var center = this.coordinateToPageXY(placemark.bounds.center, topLeftXY, aspect, pageMargin);
          
          var textOptions = {
            point: [center[0], center[1] + placeLabelOptions.fontSize*textVerticalCenterOffset],
            content: placemark.name,
            justification: 'center',
            fillColor: placeLabelOptions.color,
            fontSize: placeLabelOptions.fontSize,
            fontFamily: placeLabelOptions.fontFamily,
            fontWeight: placeLabelOptions.fontWeight,
          }
          
          switch (placeLabelOptions.style) {
            case 'center':
              folderItems.labels.push(new paper.PointText(textOptions));
              break;
            case 'flag':
              var textPoint = this.getFlagTextPoint(textOptions.point, placeLabelOptions);
              textOptions.point = [textPoint[0], textPoint[1] + placeLabelOptions.fontSize*textVerticalCenterOffset],
              textOptions.content = ' ' + textOptions.content + ' ';
              textOptions.justification = this.getFlagTextJustification(placeLabelOptions);
              var labelItems = [];
              var flagAnchor = this.createFlagAnchorShape(center, placeLabelOptions.flagAnchorShape, placeLabelOptions.flagAnchorSize, placeLabelOptions.flagColor);
              if (flagAnchor) labelItems.push(flagAnchor);
              labelItems.push(new paper.Path.Line({
                from: center,
                to: textPoint,
                strokeColor: placeLabelOptions.flagColor,
                strokeWidth: 1
              }));
              labelItems.push(new paper.PointText(textOptions));
              folderItems.labels.push(new paper.Group(labelItems));
              break;
          }
          
        }
        
      }, this);
      
      // Create groups for any non-empty items and add to top level groups
      _(folderItems).each(function(items, type) {
        if (!items.length) return;
        var group = new paper.Group(items);
        group.name = folderId + '-' + type;
        topGroups[type].addChild(group);
      });
      
    }, this);
    
    // Remove any empty top level groups
    _(topGroups).each(function(group) {
      if (!group.children.length) group.remove();
    });
    
		paper.view.draw();
  }
  
  refreshDisplayOptions() {
    // Update the sidebar display options.
    var options = {
      map: $.extend(true, {}, this.displayOptions)
    }
    if (this.kmlData) {
      _(this.kmlData.folders).each(function(folder, fIndex) {
        var folderOptions = options.map.folders[fIndex];
        folderOptions.name = folder.name;
        folderOptions.placeCount = folder.placemarks.length;
        folderOptions.hiddenPlaceCount = _(folderOptions.places).where({show:false}).length;
        if (fIndex == this.activeFolderIndex) {
          options.folder = folderOptions;
        }
        _(folder.placemarks).each(function(placemark, pIndex) {
          folderOptions.places[pIndex].name = placemark.name;
        });
      }, this);
    }
    
    var html = Handlebars.compile($('#display-options').html())(options);
    $('.sidebar .display-options').html(html);
    
    $('.sidebar .display-options .settings-page').hide();
    $('.sidebar .display-options .settings-page[data-page="' + this.activePage + '"]').show();
    
    var pageOptions = options.map.page;
    $('select[data-property="page.orientation"]').val(pageOptions.orientation);
    $('.row.page-orientation-custom-fields').toggle(pageOptions.orientation == 'custom');
    
    var shapeOptions = options.map.shapes;
    $('select[data-property="shapes.lineStyle"]').val(shapeOptions.lineStyle);
    $('.row.shapes-lineStyle-fields').toggle(shapeOptions.lineStyle == 'custom');
    $('select[data-property="shapes.fillStyle"]').val(shapeOptions.fillStyle);
    $('.row.shapes-fillStyle-fields').toggle(shapeOptions.fillStyle == 'custom');

    var placeLabelOptions = options.map.placeLabels;
    $('fieldset.placeLabels .container.fields').toggle(placeLabelOptions.show);
    $('select[data-property="placeLabels.style"]').val(placeLabelOptions.style);
    $('.row.placeLabels-style-flag-fields').toggle(placeLabelOptions.style == 'flag');
    $('select[data-property="placeLabels.flagDirection"]').val(placeLabelOptions.flagDirection);
    $('select[data-property="placeLabels.flagAnchorShape"]').val(placeLabelOptions.flagAnchorShape);
    
    var measurementOptions = options.map.measurements;
    $('fieldset.measurements .container.fields').toggle(measurementOptions.show);
    
    _(options.map.folders).each(function(folder, index) {
      var $folderGroup = $('.sidebar .folder-list fieldset.folder[data-index="' + index + '"]');
      $('.container.fields', $folderGroup).toggle(folder.show);
    });
  }
  
  loadDisplayOptions() {
    this.displayOptions = $.extend(true, {}, defaultDisplayOptions);
    try {
      var savedDisplayOptions = LocalStorage.getItem('displayOptions_default');
      if (savedDisplayOptions) {
        this.displayOptions = $.extend(true, this.displayOptions, JSON.parse(savedDisplayOptions));
      }
    } catch (err) {}
    if (this.kmlData && this.kmlData.mid) {
      try {
        savedDisplayOptions = LocalStorage.getItem('displayOptions_' + this.kmlData.mid);
        if (savedDisplayOptions) {
          this.displayOptions = $.extend(true, this.displayOptions, JSON.parse(savedDisplayOptions));
        }
      } catch (err) {}
      
      // Incorporate saved folder options
      var folderIndexes = {}
      var folderOptions = this.displayOptions.folders;
      this.displayOptions.folders = _(this.kmlData.folders).map(function(folder) {
        var folderId = this.nameToId(folder.name);
        if (!_(folderIndexes).has(folderId)) {
          folderIndexes[folderId] = 0;
        } else {
          folderIndexes[folderId]++;
        }
        var folderIndex = folderIndexes[folderId];
        
        // Default folder options.
        var options = {
          show: true,
          places: []
        }
        var savedFolderOptions = _(folderOptions).where({id: folderId});
        
        var savedOptions = null;
        if (folderIndex < savedFolderOptions.length) {
          var savedOptions = savedFolderOptions[folderIndex];
          options = $.extend(true, options, savedOptions);
        }
        
        // Incorporate saved place options
        var placeIndexes = {}
        options.places = _(folder.placemarks).map(function(place) {
          var placeId = this.nameToId(place.name);
          if (!_(placeIndexes).has(placeId)) {
            placeIndexes[placeId] = 0;
          } else {
            placeIndexes[placeId]++;
          }
          var placeIndex = placeIndexes[placeId];
          
          // Default place options.
          var newPlaceOptions = {
            show: true,
          }
          if (savedOptions) {
            var savedPlaceOptions = _(savedOptions.places).where({id: placeId});
            
            if (placeIndex < savedPlaceOptions.length) {
              newPlaceOptions = $.extend(true, newPlaceOptions, savedPlaceOptions[placeIndex]);
            }
          }
          
          newPlaceOptions.id = placeId;
          newPlaceOptions.index = placeIndex;
          
          return newPlaceOptions;
        }, this);
        
        options.id = folderId;
        options.index = folderIndex;
        
        return options;
      }, this);
    }
  }
  
  saveDisplayOptions() {
    var defaultOptions = $.extend(true, {}, this.displayOptions);
    defaultOptions.folders = [];
    LocalStorage.setItem('displayOptions_default', JSON.stringify(defaultOptions));
    if (this.kmlData && this.kmlData.mid) {
      LocalStorage.setItem('displayOptions_' + this.kmlData.mid, JSON.stringify(this.displayOptions));
    }
  }
  
  saveSvg(filename) {
    var previousZoom = this.pageZoom;
    this.pageZoom = 1;
    this.updateCanvas();
    var text = paper.project.exportSVG({asString:true});
    this.pageZoom = previousZoom;
    this.updateCanvas();
    var blob = new Blob([text], {type: 'image/svg+xml;charset=utf-8'});
    saveAs(blob, filename);
  }
  
  /**
   * Convert a [lat,lng] pair into a X,Y pair relative to the top left of the document, padded by the
   * page margin, and stretched to the aspect. Basically this takes a GPS point and puts it in the
   * correct spot on the SVG document.
   */
  coordinateToPageXY(coordinate, topLeftXY, aspect, pageMargin) {
    var point = Geo.coordinateToPoint(coordinate);
    return _(point).map(function(coord, index) {
      return (coord - topLeftXY[index]) * aspect + pageMargin[index];
    });
  }
  
  /**
   * Generate an XML friendly id from a folder/place name
   */
  nameToId(name) {
    return name
      .replace('&', 'and')
      .replace(/[ _]/g, '-')
      .replace(/[^A-Za-z0-9\-]/g, '')
      .toLowerCase();
  }
  
  getFlagTextPoint(point, options) {
    var offset = [30,10];
    if (_(['aboveright', 'aboveleft']).contains(options.flagDirection)) {
      offset[1] = -offset[1];
    }
    if (_(['belowleft', 'aboveleft']).contains(options.flagDirection)) {
      offset[0] = -offset[0];
    }
    return _(point).map(function(p, index) {
      return p + offset[index];
    });
  }
  
  getFlagTextJustification(options) {
    var rightSide = _(['aboveright', 'belowright']).contains(options.flagDirection);
    return rightSide ? 'left' : 'right';
  }
  
  createFlagAnchorShape(center, shape, size, color) {
    switch(shape) {
      case 'circle':
        return new paper.Shape.Circle({
          center: center,
          radius: size*0.5,
          fillColor: color
        });
      case 'square':
        return new paper.Path.RegularPolygon({
          center: center,
          sides: 4,
          radius: size*0.6,
          fillColor: color
        });
      case 'star':
        var shape = new paper.Path.Star({
          center: center,
          points: 5,
          radius1: size*0.3,
          radius2: size*0.6,
          fillColor: color
        });
        shape.rotate(180);
        return shape;
      case 'triangle':
        return new paper.Path.RegularPolygon({
          center: center,
          sides: 3,
          radius: size*0.6,
          fillColor: color
        });
      case 'diamond':
        var shape = new paper.Path.RegularPolygon({
          center: center,
          sides: 4,
          radius: size*0.6,
          fillColor: color
        });
        shape.rotate(45);
        return shape;
    }
    return null;
  }
}

var app = new App();

/**
 * jQuery load handler, set up button click handlers.
 */
$(function() {
  $('#open-map-button').on('click', function() {
    app.selectMap();
  });
  $('#save-svg-button').on('click', function() {
    app.saveSvg('map.svg');
  });
  $('#zoom-in-button').on('click', function() {
    app.zoomIn();
  });
  $('#zoom-out-button').on('click', function() {
    app.zoomOut();
  });
  app.refreshDisplayOptions();
  
  var urlMid = null;
  if(window.location.search) {
    var hashParts = {};
    _(window.location.search.substring(1).split('&')).each(function(part) {
      var keyValue = part.split('=');
      if (keyValue.length < 2) keyValue.push(true);
      if (keyValue.length > 1) hashParts[keyValue[0]] = keyValue[1];
    });
    urlMid =hashParts.mid;
  }
  if (urlMid) {
    app.fetchMap('https://www.google.com/maps/d/u/0/viewer?mid=' + urlMid);
  } else {
    app.selectMap();
  }
});
