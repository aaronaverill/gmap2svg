/*
 * Metadata about display options for editing dialog.
 */
var displayParams = {
  pageWidth: {type: 'float'},
  pageHeight: {type: 'float'},
  pageMargin: {type: 'float'},
  showPlaceLabels: {type: 'check'},
  showEdgeMeasurements: {type: 'check'},
  blackAndWhite: {type: 'check'},
  outlineOnly: {type: 'check'},
  labelDotRadius: {type: 'float'},
}

/*
 * Display options determine how the svg is styled from map elements.
 */
var displayOptions = {
  pageWidth: 850,
  pageHeight: 1100,
  pageMargin: 20,
  backgroundColor: '#B3DBA2', // Light green "grass"
  blackAndWhite: false,
  outlineOnly: false,
  showEdgeMeasurements: false,
  measurementFont: '3pt arial',
  showPlaceLabels: true,
  labelFont: '5pt arial',
  labelAnchorOffset: [30, 10],
  labelLineColor: '#000000',
  labelDotFillColor: '#000000',
  labelDotRadius: 2,
  folders: []
}

/*
 * KML data parsed into an internal structure we can deal with.
 */
var mapData = null;

/*
 * Export the SVG to a file.
 */
function exportSvg(filename) {
  var text = $('.svg-doc').html();
  text = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>' + text;
  var blob = new Blob([text], {type: 'image/svg+xml;charset=utf-8'});
  saveAs(blob, filename);
}

/*
 * Asynchronously fetch the KML data from a Google My Maps URL and call success or error function when complete.
 * Uses cors-anywhere to get around CORS issues in browser scripting. El Lameo. 
 */
function getKml(gmapUrl, success, error) {
  var url = new URL(gmapUrl);
  var mid = url.searchParams.get('mid');
  if (!mid) {
    alert("ERROR: Can't get Google Map ID");
    return;
  }
  url = 'https://www.google.com/maps/d/u/0/kml?mid=' + mid + '&forcekml=1';  
  url = 'https://cors-anywhere.herokuapp.com/' + url;
  
  $.ajax(url, {
    success: success,
    error: error
  });
}

/*
 * Return north, south, east, west coordinates and center point that bound the coordinate pairs [lat, lon]
 */
function getBoundingBox(coordinates) {
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
}

/*
 * Get a node child by path. Like a really cheap and dirty version of XPath, lol.
 */
function getSubNode(node, path) {
  return _(path.split('/')).reduce(function(ele, part) {
    if (!ele) return null;
    var child = ele.getElementsByTagName(part);
    return child.length ? child[0] : null;
  }, node);
}

/*
 * Parse KML coordinate text into an array of [lat,lng] float pairs.
 */
function getCoordinateData(coordinatesNode) {
  if (!coordinatesNode) return [];
  return _(coordinatesNode.childNodes[0].nodeValue.trim().split('\n')).map(function(coordinate) {
    // Kml coordinates are longitude, latitude, flip and parse into float [lat,lng]
    coordinate = coordinate.trim().split(',');
    return _([coordinate[1], coordinate[0]]).map(function(c) {
      return parseFloat(c);
    });
  });
}

/*
 * Follow the style ID to get the actual style node in the KML document.
 */
function getStyleByUrl(kmlDoc, styleUrl) {
  if (!styleUrl.length || styleUrl[0] != '#') return null;
  return kmlDoc.getElementById(styleUrl.substr(1));
}

/*
 * Parse KML color info into an opacity, RGB pair.
 */
function getColorInfo(colorNode) {
  var color = colorNode.childNodes[0].nodeValue;
  return [
    parseInt(color.substr(0, 2), 16) / 256,
    '#' + color.substr(6, 2) + color.substr(4, 2) + color.substr(2, 2)
  ]
}

/* 
 * Extract a text node and clean it up.
 * Adobe Illustrator can't handle &nbsp; in SVG file. Convert to space.
 * Why so picky Adobe?
 */
function cleanTextNodeValue(node) {
  return node[0].childNodes[0].nodeValue.trim().replace(/\u00a0/g, ' ');
}

/*
 * Parse the KML document into a structure of things we care about that is actually useful.
 * Basically, this creates a document that has an array of folders, each folder has a name
 * and an array of placemarks, each placemark has a name and some geography features 
 * such as a polygon, line, or icon. While parsing unravel all the linked style information and 
 * attach it to the placemark features.
 */
function parseKml(kmlDoc) {
  var data = {};
  var doc = kmlDoc.documentElement.getElementsByTagName('Document')[0];
  data.title = cleanTextNodeValue(doc.getElementsByTagName('name'));
  data.folders = _(doc.getElementsByTagName('Folder')).map(function(kmlFolder) {
    var folder = {};
    folder.name = cleanTextNodeValue(kmlFolder.getElementsByTagName('name'));
    folder.placemarks = _(kmlFolder.getElementsByTagName('Placemark')).map(function(kmlPlacemark) {
      var placemark = {
        name: cleanTextNodeValue(kmlPlacemark.getElementsByTagName('name')),
        style: {}
      };
      
      // Read the style information
      var styleUrl = kmlPlacemark.getElementsByTagName('styleUrl')[0].childNodes[0].nodeValue;
      var style = getStyleByUrl(kmlDoc, styleUrl);
      // If it's a style map element, get the normal style
      if (style && style.tagName == 'StyleMap') {
        var normalPair = _(style.getElementsByTagName('Pair')).find(function(pair) {
          var key = pair.getElementsByTagName('key')[0].childNodes[0].nodeValue;
          return key == 'normal';
        });
        if (normalPair) {
          styleUrl = normalPair.getElementsByTagName('styleUrl')[0].childNodes[0].nodeValue;
          style = getStyleByUrl(kmlDoc, styleUrl);
        } else {
          style = null;
        }
      }
      // Extract the style info
      if (style) {
        var lineStyle = style.getElementsByTagName('LineStyle')[0];
        if (lineStyle) {
          var color = getColorInfo(lineStyle.getElementsByTagName('color')[0]);
          placemark.style.strokeOpacity = color[0];
          placemark.style.strokeColor = color[1];
          placemark.style.strokeWidth = parseFloat(lineStyle.getElementsByTagName('width')[0].childNodes[0].nodeValue);
        }
        var polyStyle = style.getElementsByTagName('PolyStyle')[0];
        if (polyStyle) {
          var color = getColorInfo(polyStyle.getElementsByTagName('color')[0]);
          placemark.style.fillOpacity = color[0];
          placemark.style.fillColor = color[1];
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
      var polygon = getCoordinateData(getSubNode(kmlPlacemark, 'Polygon/outerBoundaryIs/LinearRing/coordinates'));
      if (polygon.length) {
        placemark.polygon = {
          coordinates: polygon
        }
      }
      
      // LineString
      var lineString = getCoordinateData(getSubNode(kmlPlacemark, 'LineString/coordinates'));
      if (lineString.length) {
        placemark.lineString = {
          coordinates: lineString
        }
      }
      
      // Point
      var point = getCoordinateData(getSubNode(kmlPlacemark, 'Point/coordinates'));
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

/*
 * Convert a [lat,lng] pair into a global X,Y pair that matches the Google Maps projection system.
 * X values > 0 and increase from west to east. Y values > 0 and increase from north to south.
 */
function coordinateToPoint(coordinate) {
  var x = (coordinate[1] + 180) / 360 * 256;
  var y = ((1 - Math.log(Math.tan(coordinate[0] * Math.PI / 180) + 1 / Math.cos(coordinate[0] * Math.PI / 180)) / Math.PI) / 2) * 256;
  return [x, y];
};

/*
 * Convert a [lat,lng] pair into a X,Y pair relative to the top left of the document, padded by the
 * page margin, and stretched to the aspect. Basically this takes a GPS point and puts it in the
 * correct spot on the SVG document.
 */
function coordinateToXY(coordinate, topLeft, pageMargin, aspect) {
  var point = coordinateToPoint(coordinate);
  return [
    (point[0] - topLeft[0]) * aspect + pageMargin,
    (point[1] - topLeft[1]) * aspect + pageMargin
  ];
}

/*
 * Return the distance between two points in meters
 */
function measureDistance(coord1, coord2) {
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
}

/*
 * Convert a floating point meters into a feet+inches label such as 11'9"
 */
function metersToFeetInches(meters) {
  var feet = Math.floor(meters);
  var inch = Math.round((meters - feet)*12);
  if (inch >= 12) {
    feet++;
    inch -= 12;
  }
  return feet + '\'' + inch + '"';
}

function getLabelOffset(offset, labelStyle) {
  switch (labelStyle) {
    case 'topleft':
      return [-offset[0], -offset[1]];
    case 'topright':
      return [offset[0], -offset[1]];
    case 'bottomleft':
      return [-offset[0], offset[1]];
    case 'bottomright':
      return offset;
    default:
      return [0, 0];
  }
}

/*
 * Generate the SVG XML from the parsed KML data using the display options.
 */
function generateSvg(allData) {
  // Copy the data and display options
  var data = $.extend(true, {}, allData);
  _(data.folders).each(function(folder, fIndex) {
    folder.displayOptions = displayOptions.folders[fIndex];
    if (!folder.displayOptions) return;
    _(folder.placemarks).each(function(placemark, pIndex) {
      if (!folder.displayOptions.placemarks || pIndex >= folder.displayOptions.placemarks.length) return;
      placemark.displayOptions = folder.displayOptions.placemarks[pIndex];
    });
  });
  // Filter out hidden folders and placemarks
  data.folders = _(data.folders).reject(function(folder, index) {
    return folder.displayOptions && folder.displayOptions.hide;
  });
  _(data.folders).each(function(folder) {
    if (!folder.displayOptions || !folder.displayOptions.placemarks) return;
    folder.placemarks = _(folder.placemarks).reject(function(placemark) {
      return placemark.displayOptions && placemark.displayOptions.hide;
    });
  });

  // Create the svg document
  var doc = new svg.Document({
    width: displayOptions.pageWidth,
    height: displayOptions.pageHeight,
  });
  if (displayOptions.backgroundColor != 'transparent') {
    doc.items.push(new svg.Rectangle({
      width: '100%',
      height: '100%',
      fillColor: displayOptions.backgroundColor,
    }));
  }
  
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
      placemark.bounds = getBoundingBox(placemark.allCoordinates);
      coordinates = coordinates.concat(placemark.allCoordinates);
    });
  });
  if (!coordinates.length) {
    return doc.html();
  }
    
  var bounds = getBoundingBox(coordinates);
  
  // A few top-level groups so labels and icons are overlayed on top of geography outlines
  var allIconsGroup = new svg.Group();
  var allLabelsGroup = new svg.Group();

  var topLeft = coordinateToPoint([bounds.north, bounds.west]);
  var bottomRight = coordinateToPoint([bounds.south, bounds.east]);
  var size = [bottomRight[0] - topLeft[0], bottomRight[1] - topLeft[1]];
  var aspect = [
    (doc.width - (displayOptions.pageMargin * 2)) / size[0], 
    (doc.height - (displayOptions.pageMargin * 2)) / size[1]];
  aspect = Math.min(aspect[0], aspect[1]);

  _(data.folders).each(function(folder, index) {
      var folderOptions = folder.displayOptions;
      var folderGroup = new svg.Group();
      var folderIconGroup = new svg.Group();
      var folderLabelGroup = new svg.Group();
      
    _(folder.placemarks).each(function(placemark, index) {
      if (!placemark.bounds) return;
      
      var placemarkOptions = placemark.displayOptions;
      
      if (placemark.polygon) {
        // Create a svg.Polygon element
        var points = _(placemark.polygon.coordinates).map(function(coordinate) {
          return coordinateToXY(coordinate, topLeft, displayOptions.pageMargin, aspect);
        });
        
        var options = _.extend({points: points}, placemark.style);
        if (displayOptions.blackAndWhite) {
          options.fillColor = '#000000';
          options.strokeColor = '#000000';
        }
        if (displayOptions.outlineOnly) {
          options.fillColor = 'none';
          options.strokeOpacity = 0.2;
        }
        var polygon = new svg.Polygon(options);
        folderGroup.items.push(polygon);  
      }
      if (placemark.lineString) {
        // Create a svg.Polyline element
        var points = _(placemark.lineString.coordinates).map(function(coordinate) {
          return coordinateToXY(coordinate, topLeft, displayOptions.pageMargin, aspect);
        });
        
        var options = _.extend({points: points}, placemark.style);
        options.fillColor = 'none';
        options.strokeLinecap = svg.Linecap.Round;
        options.strokeLinejoin = svg.Linejoin.Round;
        var polygon = new svg.Polyline(options);
        folderGroup.items.push(polygon);  
      }
      if (placemark.point && placemark.icon) {
        var point = coordinateToXY(placemark.point.coordinate, topLeft, displayOptions.pageMargin, aspect);
        // Should get image sizes but need to do that asynchronously and it's tricky.
        var size = [20,20];
        size = _(size).map(function(length) {
          return length * placemark.icon.scale;
        });
        var img = new svg.Image({
          x: point[0] - size[0]/2,
          y: point[1] - size[1]/2,
          width: size[0],
          height: size[1],
          url: placemark.icon.href
        });
        folderIconGroup.items.push(img);
      }
      
      // Labels
      if (displayOptions.showEdgeMeasurements) {
        if (placemark.polygon) {
          // Measure distances
          var lastCoordinate = null;
          _(placemark.polygon.coordinates).each(function(coordinate) {
            if (lastCoordinate) {
              var center = [
                (coordinate[0] + lastCoordinate[0])/2,
                (coordinate[1] + lastCoordinate[1])/2
              ]
              var center = coordinateToXY(center, topLeft, displayOptions.pageMargin, aspect);
              var distance = measureDistance(lastCoordinate, coordinate);
              var label = metersToFeetInches(distance);
              var text = new svg.Text({
                x: center[0],
                y: center[1],
                dy: '0.2em',
                textAnchor: 'middle',
                style: 'font: ' + displayOptions.measurementFont,
                text: label
              });
              folderLabelGroup.items.push(text);
            }
            lastCoordinate = coordinate;
          });
        }
      }
      
      var labelStyle = placemarkOptions ? placemarkOptions.labelStyle : 'topright';
      if (displayOptions.showPlaceLabels && labelStyle != 'none') {
        var center = coordinateToXY(placemark.bounds.center, topLeft, displayOptions.pageMargin, aspect);

        var labelAnchorOffset = displayOptions.labelAnchorOffset;
        if (!labelAnchorOffset) labelAnchorOffset = [0, 0];
        
        labelAnchorOffset = getLabelOffset(labelAnchorOffset, labelStyle);
        var labelAnchor = _(center).map(function(v, i) {
          return v + labelAnchorOffset[i];
        });
        var text = new svg.Text({
          x: labelAnchor[0],
          y: labelAnchor[1],
          dy: '0.2em',
          textAnchor: 'middle',
          style: 'font: ' + displayOptions.labelFont,
          text: placemark.name
        });
        if (center[0] != labelAnchor[0] || center[1] != labelAnchor[1]) {
          switch(labelStyle) {
            case 'topleft':
            case 'bottomleft':
              text.textAnchor = 'end';
              break;
            default:
              text.textAnchor = 'start';
              break;
          }
          var labelGroup = new svg.Group();
          if (displayOptions.labelDotRadius) {
            var dot = new svg.Circle({
              cx: center[0],
              cy: center[1],
              r: displayOptions.labelDotRadius,
              fillColor: displayOptions.labelDotFillColor,
            });
            labelGroup.items.push(dot);
          }
          var line = new svg.Line({
            x1: center[0],
            y1: center[1],
            x2: labelAnchor[0],
            y2: labelAnchor[1],
            strokeColor: displayOptions.labelLineColor,
            strokeWidth: 1
          });
          labelGroup.items.push(line);
          labelGroup.items.push(text);
          folderLabelGroup.items.push(labelGroup);
        } else {
          folderLabelGroup.items.push(text);
        }
      }
      
    });
    doc.items.push(folderGroup);
    allIconsGroup.items.push(folderIconGroup);
    allLabelsGroup.items.push(folderLabelGroup);
  });
  doc.items.push(allIconsGroup);
  doc.items.push(allLabelsGroup);
  
  return doc.html();
}

/*
 * Handle the "Generate" button click.
 */
function onGenerateClick() {
  $('.svg-doc').html('');
  getKml($('#gmap_url').val(),
    function(kmlDoc, status, xhr) {
      mapData = parseKml(kmlDoc);
      var svgXml = generateSvg(mapData);
      $('.svg-doc').html(svgXml);
      $('.svg-doc-name').text(mapData.title);
      _(['#settings-button', '#export-button']).each(function(id) {
        $(id).toggle(true);
      });
    },
    function(xhr, status) {
      mapData = null;
      _(['#settings-button', '#export-button']).each(function(id) {
        $(id).toggle(true);
      });
    }
  );
}

/*
 * Handle the "Settings" button click.
 */
function onSettingsClick() {
  var changed = false;
  var dialog = $('#settings-dialog').html();
  var templateData = $.extend(true, {}, displayOptions, {folders: []});
  templateData.anchorLength = displayOptions.labelAnchorOffset[0];
  // Add the map's folders + placemarks to the display options.
  if (mapData) {
    templateData.folders = _(mapData.folders).map(function(folder) {
      var folderData = {
        name: folder.name,
        hide: false,
      }
      folderData.placemarks = _(folder.placemarks).map(function(placemark) {
        return {
          name: placemark.name,
          labelStyle: 'topright',
        }
      });
      folderData.placeCount = folderData.placemarks.length;
      return folderData;
    });
    // Incorporate the current settings. YUCK.
    var numFolders = templateData.folders.length;
    _(displayOptions.folders).each(function(folder, fIndex) {
      if (fIndex >= numFolders) return;
      var folderData = templateData.folders[fIndex];
      folderData.hide = folder.hide;
      var numPlacemarks = folderData.placemarks.length;
      _(folder.placemarks).each(function(placemark, pIndex) {
        if (pIndex >= numPlacemarks) return;
        var placemarkData = folderData.placemarks[pIndex];
        placemarkData.labelStyle = placemark.labelStyle;
      });
    });
    displayOptions.folders = $.extend(true, [], templateData.folders);
  }
  dialog = Handlebars.compile(dialog)(templateData);
  $(dialog).dialog({
    dialogClass: 'settings',
    width: 600,
    height: 500,
    draggable: false,
    resizable: false,
    position: {
      my: 'center top',
      at: 'center top+20',
      of: window
    },
    open: function() {
      _(displayOptions.folders).each(function(folder, fIndex) {
        _(folder.placemarks).each(function(placemark, pIndex) {
          var $labelStyle = $('.folder-settings-page.folder-' + fIndex + ' .placemark.placemark-' + pIndex + ' select.labelStyle');
          $labelStyle.val(placemark.labelStyle);
          $labelStyle.click(function() {
            displayOptions.folders[fIndex].placemarks[pIndex].labelStyle = $(this).val();
            changed = true;
          });
        });
      });
      $('.ui-dialog.settings fieldset.folder .folder-show input').change(function() {
        var $checkbox = $(this);
        var $fieldset = $checkbox.closest('fieldset');
        var $button = $('button.settings', $fieldset);
        $button.toggle($checkbox.is(':checked'));
      });
      $('.ui-dialog.settings fieldset.folder button.settings').click(function() {
        var $fieldset = $(this).closest('fieldset');
        var folderIndex = $fieldset.data('index');
        $('#settings-main-page').hide();
        var $page = $('.folder-settings-page.folder-' + folderIndex);
        $page.show();
        $page.parent().scrollTop(0);
      });
      $('.ui-dialog.settings .folder-settings-page button.back').click(function() {
        $('.folder-settings-page').hide();
        var $page = $('#settings-main-page');
        $page.show();
        $page.parent().scrollTop(0);
      });
    },
    close: function() {
      _(displayOptions).each(function(value, field) {
        var $input = $('.ui-dialog.settings #settings-' + field);
        if (!$input.length) return;
        var inputValue = $input.val();
        if (displayParams[field]) {
          switch (displayParams[field].type) {
            case 'float':
              inputValue = parseFloat(inputValue);
              break;
            case 'check':
              inputValue = $input.is(':checked');
              break;
          }
        }
        if (inputValue != value) {
          displayOptions[field] = inputValue;
          changed = true;
        }
      });
      var inputValue = parseFloat($('#settings-anchorLength').val());
      if (inputValue != displayOptions.labelAnchorOffset[0]) {
        displayOptions.labelAnchorOffset = [inputValue, inputValue/3];
        changed = true;
      }
      var index = 0;
      $('.ui-dialog.settings fieldset.folder').each(function() {
        var $input = $('.folder-show input', this);
        var hide = !$input.is(':checked');
        if (hide != displayOptions.folders[index].hide) {
          displayOptions.folders[index].hide = hide;
          changed = true;
        }
        index++;
      });
      
      $(this).dialog('destroy').remove();
      if (changed && mapData) {
        var svgXml = generateSvg(mapData);
        $('.svg-doc').html(svgXml);
        $('.svg-doc-name').text(mapData.title);
      }
    }
  });
}

/*
 * jQuery load handler, set up button click handlers.
 */
$(function() {
  $('#generate-button').click(onGenerateClick);
  $('#settings-button').click(onSettingsClick);
  $('#export-button').click(function() {
    exportSvg('document.svg');
  });
});
