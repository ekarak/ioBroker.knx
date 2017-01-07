/**
 * Created by KRingmann on 01.09.2016.
 * Severely edited by ekarak on 07.01.2017
 */
// generate JSON-object with complete GAS
/* schema from https://github.com/ioBroker/ioBroker/blob/master/doc/SCHEMA.md#object-types
 // state-working (optional)
 {
 "_id": "adapter.instance.channelName.stateName-working", // e.g. "hm-rpc.0.JEQ0205612:1.WORKING"
 "type": "state",
 "parent": "channel or device",       // e.g. "hm-rpc.0.JEQ0205612:1"
 "common": {
 "name":  "Name of state",        // mandatory, default _id ??
 "def":   false,                  // optional,  default false
 "type":  "boolean",              // optional,  default "boolean"
 "read":  true,                   // mandatory, default true
 "write": false,                  // mandatory, default false
 "min":   false,                  // optional,  default false
 "max":   true,                   // optional,  default true
 "role":  "indicator.working"     // mandatory
 "desc":  ""                      // optional,  default undefined
 }
 }
 */

'use strict';
var debug = true;
var admZip     = require('adm-zip');
//var utils =    require(__dirname + '/utils'); // Get common adapter utils
var modRoleObj = require(__dirname + '/dpt2iobroker');
var similarity = require("similarity");
var fs = require('fs');
var path = require('path');
var xml2js = require('xml2js');
var xpath = require('xml2js-xpath');
var _ = require('underscore');

var extend = require('util')._extend;

var matchesRes;
var matchesFirstConnectorGaRefMap;
var objects = [];

module.exports = {

    createIoBrokerObject: function(hg,mg,ug, dptObj, dpstObj) {
        var adr = adr2ga(ug.$.Address);
        var iy = matchesFirstConnectorGaRefMap.indexOf(ug.$.Id);
        if (iy == -1 || !matchesRes.hasOwnProperty(iy)) {
          //console.log('bazookas! iy=%d', iy);
          return;
        }
        var dpt = (matchesRes[iy].$.hasOwnProperty('DatapointType')) ?
            matchesRes[iy].$.DatapointType :
            matchesRes[1].$.DatapointType;
        if (ug.$.hasOwnProperty('DatapointType')) {
            dpt = ug.$.DatapointType;
        }
        if (debug) console.log('%s (%s): %s', adr, dpt, ug.$.Name);
        var readFlag, writeFlag, transmitFlag, updateFlag;
        readFlag = matchesRes[iy].$.ReadFlag || 'Enabled';
        writeFlag = matchesRes[iy].$.WriteFlag || 'Enabled';
        updateFlag = matchesRes[iy].$.UpdateFlag || 'Enabled';
        transmitFlag = matchesRes[iy].$.TransmitFlag || 'Enabled';

        matchesRes.splice(iy,1);

        var setMin, setMax;
        var stateFlag = 0;

        if (dpt && !dpt.match('DP')) {
            dpt = 'not defined in ETS';
        }

        if (transmitFlag === 'Enabled') {
            var ioobj = this.populateIoBrokerObject(
              adr, hg, mg, ug, readFlag, writeFlag, updateFlag,
              dpt, dptObj, dpstObj);
            objects.push(ioobj);
        }
    },

    // create an ioBroker object for the given knx connection object
    populateIoBrokerObject : function (adr, hg, mg, ug, readFlag, writeFlag, updateFlag, dpt, dptObj, dpstObj) {
      var values = setValues(readFlag, writeFlag, updateFlag, dpt, dptObj, dpstObj);

      if (!values.setRole) {
          values.setRole = 'indicator';
      }

      var roletmp = values.setRole + (values.setType === '' ? '' : '.' + values.setType);
      var tmpobj = {
          _id: hg.$.Name.replace(/[\.\s]/g, '_') + '.' + mg.$.Name.replace(/[\.\s]/g, '_') + '.' + ug.$.Name.replace(/[\.\s]/g, '_'),
          type: 'state',
          common: {
              name: ug.$.Name,                // mandatory, default _id ??
              type: values.stateType || values.setType,           // optional,  default "boolean", number, string
              read: changeValue(readFlag),   // mandatory, default true
              write: changeValue(writeFlag),  // mandatory, default false
              role: roletmp,           // read-only: indicator.(light, alarm, alarm.water), indicator.motion
              // read-write: state, switch, button, level.(dimmer, blind, rgb.red, rgb.blue, rgb.green, rgb #FFAEEA, hsv.hue, hsv.saturation, hsv.)
              desc: dpt                      // optional,  default undefined
          },
          native: {
              address: adr,
              addressRefId : ug.$.Id
          }
      };
      if (values.setMin !== undefined) tmpobj.common.min = values.setMin;
      if (values.setMax !== undefined) tmpobj.common.max = values.setMax;
      return tmpobj;
    },

    // generate rooms with functions of com-Object of room-assigned components
    getRoomFunctions : function(fileName, knx_master, callback) {
        this.callback = callback;
        if (typeof knx_master === 'function') {
            this.callback = knx_master;
            knx_master = null;
        }

        function processFile (err, knxMaster, xml0) {

            if (err) {
                return callback(err);
            }
            // generate object of building/projectstructure components
            parser.parseString(xml0, function (err, result) {

//                var roomObj = {};

                var roomFunctionObj = [];

//                var room = {};
                var building = {};
                var tmproomObj = {};
                var tmpBuildingObj = {};

//                var xml0devInstanceId = xpath.find(result, "//DeviceInstance", "Id");
                //var tmpObj = {};
                var ugNameList;


                //var doc = new dom().parseFromString(xml0);
                var devices = xpath.find(result, "//DeviceInstance");
                var building = xpath.find(result, "//BuildingPart");

                for (var a = 0; a < building.length; a++) {
                    var rooms = building[a].BuildingPart;
                    for (var b = 0; b < rooms.length; b++) {
                        var roomName = rooms[b].$.Name;
                        ugNameList = '';
                        var deviceInstanceRef = [];
                        if (rooms[b].DeviceInstanceRef) {
                            deviceInstanceRef = rooms[b].DeviceInstanceRef;
                            for (var c = 0; c < deviceInstanceRef.length; c++) {
                                var refId = deviceInstanceRef[c].$.RefId;
                                for (var d = 0; d < devices.length; d++) {
                                    var device = devices[d];
                                    if (device.ComObjectInstanceRefs) {
                                        if (device.$.Id === refId) {
                                            var comObjectInstanceRefs = devices[d];
                                            if (!(comObjectInstanceRefs.ComObjectInstanceRefs === undefined)) {
                                                var comObjectInstanceRef = comObjectInstanceRefs.ComObjectInstanceRefs;
                                                for (var e = 0; e < comObjectInstanceRef.length; e++) {
                                                    var tmpcomObject = comObjectInstanceRef[e];
                                                    if (tmpcomObject.ComObjectInstanceRef) {
                                                        var comObjectRef = tmpcomObject.ComObjectInstanceRef;
                                                        for (var g = 0; g < comObjectRef.length; g++) {
                                                            if (comObjectRef[g].Connectors) {
                                                                var groupAdressRefId = comObjectRef[g].Connectors[0].Send[0].$.GroupAddressRefId;
                                                                if (!(ugNameList === '')) {
                                                                    ugNameList = ugNameList + ',' + groupAdressRefId;
                                                                } else {
                                                                    ugNameList = groupAdressRefId;
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            tmproomObj = extend({building: building[a].$.Name, roomcallback: roomName, functions: ugNameList});
                        }
// with Buildingpart
                        if (rooms[b].hasOwnProperty('BuildingPart')) {
                            var partName = rooms[b].$.Name;
                            var tmpFunctionObj = [];
                            tmpFunctionObj.push({rooms: []});
                            tmpFunctionObj.rooms = [];
                            var tmpObj = {};
                            for (var x = 0; x < rooms[b].BuildingPart.length; x++) {
                                ugNameList = '';
                                if (rooms[b].BuildingPart[x].hasOwnProperty('DeviceInstanceRef')) {
                                    roomName = rooms[b].BuildingPart[x].$.Name;
                                    deviceInstanceRef = rooms[b].BuildingPart[x].DeviceInstanceRef;
                                    for (var c = 0; c < deviceInstanceRef.length; c++) {
                                        var refId = deviceInstanceRef[c].$.RefId;
                                        for (var d = 0; d < devices.length; d++) {
                                            var device = devices[d];
                                            if (device.ComObjectInstanceRefs) {
                                                if (device.$.Id === refId) {
                                                    var comObjectInstanceRefs = devices[d];
                                                    if (!(comObjectInstanceRefs.ComObjectInstanceRefs === undefined)) {
                                                        var comObjectInstanceRef = comObjectInstanceRefs.ComObjectInstanceRefs;
                                                        for (var e = 0; e < comObjectInstanceRef.length; e++) {
                                                            var tmpcomObject = comObjectInstanceRef[e];
                                                            if (tmpcomObject.ComObjectInstanceRef) {
                                                                var comObjectRef = tmpcomObject.ComObjectInstanceRef;
                                                                for (var g = 0; g < comObjectRef.length; g++) {
                                                                    if (comObjectRef[g].Connectors) {
                                                                        var groupAdressRefId = comObjectRef[g].Connectors[0].Send[0].$.GroupAddressRefId;
                                                                        if (!(ugNameList === '')) {
                                                                            ugNameList = ugNameList + ',' + groupAdressRefId;
                                                                        } else {
                                                                            ugNameList = groupAdressRefId;
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                //tmpObj.splice(1,0,{room: roomName, functions: ugNameList});


                                tmpFunctionObj.rooms.push({room: roomName, functions: ugNameList});
                            }
                            tmproomObj = extend( {building: building[a].$.Name, part: partName, floor: tmpFunctionObj});

                        }
                        roomFunctionObj.push(tmproomObj);
                        //tmpFunctionObj.length = 0;
                    }
                }

                if (typeof callback === 'function') {
                  callback(null, roomFunctionObj);
                }
            });
        }

        if (typeof knx_master === 'string' && typeof fileName === 'string') {
            processFile(null, knx_master, fileName);
        } else {
            loadProjFile(fileName, processFile);
        }
    },

    processFile: function(err, knxMaster, xml0 ) {
        if (err) {
            return callback(err);
        }
        var dptObj = {};
        var dpstObj = {};
        // var dpt;

        // generate object of possible datapoint types
        parser.parseString(knxMaster, function (err, result) {
            dptObj = xpath.find(result, "//DatapointType", "Id");
            dpstObj = xpath.find(result, "//DatapointSubtype", "Id");
        });

        // generate json object for adapter with iobroker convention
        parser.parseString(xml0, function (err, result) {
            var tmpobj = {};
            var matchesResTmp = xpath.find(result, "//ComObjectInstanceRef");
            matchesRes = [];
            for (var i = 0; i < matchesResTmp.length; i++){
                if (matchesResTmp[i].Connectors) {
                    matchesRes.push(matchesResTmp[i]);
                }
            }
            matchesFirstConnectorGaRefMap = matchesRes.map(function (img) {
              return img.Connectors[0].Send[0].$.GroupAddressRefId;
            });
            // find all elements: returns xml2js JSON of the element
            var matches = xpath.find(result, "//GroupRange", "Name");
            if (debug) console.info(matches);
            for (var ix = 0; ix < matches.length; ix++) {
                var hg = matches[ix];
                if (debug) console.info(hg.$.Name);
                var mg_all = xpath.find(hg, "//GroupRange");
                for (var ixmg = 0; ixmg < mg_all.length; ixmg++) {
                    var mg = mg_all[ixmg];
                    if (debug) console.info('    ' + mg.$.Name);
                    var ug_all = xpath.find(mg, "//GroupAddress");

                    for (var ixug = 0; ixug < ug_all.length; ixug++) {
                      module.exports.createIoBrokerObject(hg, mg, ug_all[ixug], dptObj, dpstObj);
                    }
                }
            }
            if (debug) console.log('Done knx_master.xml and 0.xml');
            if (typeof callback === 'function') callback(null, objects);
        });
    },

    // generate the Groupaddress structure
    getGAS : function(fileName, knx_master, callback) {
        if (typeof knx_master === 'function') {
            callback = knx_master;
            knx_master = null;
        }

        if (typeof knx_master === 'string' && typeof fileName === 'string') {
            this.processFile(null, knx_master, fileName);
        } else {
            loadProjFile(fileName, this.processFile);
        }
    }

};



var parser = new xml2js.Parser();

function loadProjFile (knxProjFileName, callback) {
    var knxMaster;
    var xml0;
    if (fs.existsSync(knxProjFileName)) {
        var zip = new admZip(knxProjFileName);
        var zipEntries = zip.getEntries(); // an array of ZipEntry records
        zipEntries.forEach(function (zipEntry) {
            if (zipEntry.name === 'knx_master.xml') {
                knxMaster = zip.readAsText(zipEntry.entryName) || '';
                console.log('Extracting : ' + zipEntry.name); // outputs zip entries information

                if (knxMaster !== undefined && xml0 !== undefined) {
                    callback(null, knxMaster, xml0)
                }
            }
            if (zipEntry.name === '0.xml') {
                xml0 = zip.readAsText(zipEntry.entryName) || '';
                console.log('Extracting : ' + zipEntry.name); // outputs zip entries information
                if (knxMaster !== undefined && xml0 !== undefined) {
                    callback(null, knxMaster, xml0)
                }
            }
        });
    } else {
        callback('File "' + knxProjFileName + '" not exists');
    }
}

function adr2ga(adr) {
    var str = '';

    var a = (adr >>> 11) & 0xf;
    var b = (adr >> 8) & 0x7;
    var c = adr & 0xff;
    str = a + '/' + b + '/' + c;
    return str;
}

function setValues(readFlag, writeFlag, updateFlag, dpt,  dptObj, dpstObj) {
    var roleObj = [];
    var dptName = '';

    for (var i=0; i < dptObj.length; i++){
        var tmpdpt = dptObj[i];
        if (tmpdpt.$.Id == dpt){
            dptName = tmpdpt.$.Text;
            i = dptObj.length;
        }
    }
    if (!dptName){
        for (var  i = 0; i < dpstObj.length; i ++){
            var tmpdpst = dpstObj[i];
            if (tmpdpst.$.Id == dpt){
                dptName = tmpdpst.$.Text;
                i = dpstObj.length;
            }
        }
    }

    roleObj.setDPT = dpt;

    var setRole;
    var stateFlag = 0;

    if (!readFlag) readFlag = 'Disabled';
    // the update Flag is handled like Read
    // K r w U = > value
    if ((readFlag === 'Disabled' || updateFlag === 'Enabled') && (writeFlag === 'Disabled')) {
        stateFlag = 0;
    }
    // K R w U => value
    if ((readFlag === 'Enabled' || updateFlag === 'Enabled') && (writeFlag === 'Disabled')) {
        stateFlag = 1;
    }

    // K r W U => indicator, level, switch
    if ((readFlag === 'Disabled' || updateFlag === 'Enabled') && (writeFlag === 'Enabled')) {
        stateFlag = 2;
    }

    // K R W U => indicator, level, switch
    if ((readFlag === 'Enabled' || updateFlag === 'Enabled') && (writeFlag === 'Enabled')) {
        stateFlag = 3;
    }

    // K u W u => indicator, level, switch
    if ((readFlag === 'Disabled' || updateFlag === 'Disabled') && (writeFlag === 'Enabled')) {
        stateFlag = 4;
    }

    roleObj = modRoleObj(roleObj, stateFlag);
    //roleObj.setRole = setRole;
    roleObj.setdptName = dptName;
    return roleObj;
}

function changeValue(value){
    switch (value) {
        case 'Disabled' :
            return false;
        case 'Enabled':
            return true;
    }
}


module.exports.getGAS('/tmp/panormos.knxproj');
