/*
Copyright 2020 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/


/**********************************************************************************
 * 
 * Unit tests for the DOM utilities
 * 
 *********************************************************************************/

const assert = require('assert');
const { DomUtil, XPath, XPathElement } = require('../src/domUtil.js');


describe('DomUtil', function() {

    // Tests reference data. Each item has an "xml" and "json" attribute which should match when using the toJSON or fromJSON functions
    // In so rare cases, the conversion is not totally symetric, and we provide an alternate version with "altXML" or "altJSON" attributes
    // * toJSON(xml) and toJSON(altXML) shoud be equal to altJSON if its set, or json otherwise
    // * fromJSON(json) and fromJSON(altJSON) shoud be equal to altXML if its set, or xml otherwise
    const ref = [
        { xml: '<root/>', json: '{}' },
        { xml: '<root a="hello" b="world"/>', json: '{"@a":"hello","@b":"world"}' },
        { xml: '<root><lastName>Morin</lastName><firstName>Alex</firstName></root>', json: '{"lastName":{"$":"Morin"},"firstName":{"$":"Alex"}}' },
        { xml: '<root><child></child></root>', json: '{"child":{}}', altXML: '<root><child/></root>' },
        { xml: '<root><item id="1"/><item id="2"/></root>', json: '{"item":[{"@id":"1"},{"@id":"2"}]}' },
        { xml: '<root><key value="1959"/></root>', json: '{"key":[{"@value":"1959"}]}', altJSON: '{"key":{"@value":"1959"}}'},
        { xml: '<root><key value="1959"/><key value="1960"/></root>', json: '{"key":[{"@value":"1959"},{"@value":"1960"}]}'},
        { xml: '<root bool="true"/>', json:'{"@bool":true}', altJSON:'{"@bool":"true"}'},
        { xml: '<root int="-37"/>', json:'{"@int":-37}', altJSON:'{"@int":"-37"}'},
    ];

    describe('toJSON (BadgerFish)', function() {
        test.each(ref) (
            "XML to JSON %p",
            (item) => {
                var xml = DomUtil.parse(item.xml);
                var json = JSON.stringify(DomUtil.toJSON(xml, "BadgerFish"));
                if (item.altXML) {
                    xml = DomUtil.parse(item.altXML);
                    json = JSON.stringify(DomUtil.toJSON(xml, "BadgerFish"));
                }
                var expected = item.altJSON || item.json;
                assert.equal(json, expected);
            }
          );

            it("Should convert text nodes", function() {
                var xml = DomUtil.parse("<root>Hello</root>");
                assert.equal(DomUtil.toJSON(xml, "BadgerFish")["$"], "Hello");
                xml = DomUtil.parse("<root>Hello<child> cruel</child> World</root>");
                assert.equal(DomUtil.toJSON(xml, "BadgerFish")["$"], "Hello World");
          });

          it("Should convert CDATA nodes", function() {
            var xml = DomUtil.parse("<root>Hello</root>");
            assert.equal(DomUtil.toJSON(xml, "BadgerFish")["$"], "Hello");
            xml = DomUtil.parse("<root>Hello<child></child> cruel<![CDATA[ <World>]]></root>");
            assert.equal(DomUtil.toJSON(xml, "BadgerFish")["$"], "Hello cruel <World>");
        });

        it("Should support empty CDATA nodes", function() {
            var xml = DomUtil.parse("<root><![CDATA[]]></root>");
            assert.equal(DomUtil.toJSON(xml, "BadgerFish")["$"], "");
        });

        it("Should support elements", function() {
            const xml = DomUtil.parse("<root>Hello<main test='1'></main>World</root>");
            const main = DomUtil.findElement(xml.documentElement, "main");
            assert.equal(DomUtil.toJSON(main, "BadgerFish")["@test"], "1");
        });

        it("Should skip comments", function() {
            const xml = DomUtil.parse("<root>Hello<!-- cruel --> World</root>");
            assert.equal(DomUtil.toJSON(xml, "BadgerFish")["$"], "Hello World");
        });

        it("Should support nulls", function() {
            expect(DomUtil.toJSON(null, "BadgerFish")).toBeNull();
            expect(DomUtil.toJSON(undefined, "BadgerFish")).toBeUndefined();
        });
    });

    describe('fromJSON (BadgerFish)', function() {
        test.each(ref) (
            "JSON (BadgerFish) to XML %p",
            (item) => {
                var json = JSON.parse(item.json);
                var xml = DomUtil.toXMLString(DomUtil.fromJSON("root", json, "BadgerFish"));
                var expected = item.altXML || item.xml;
                assert.equal(xml, expected);
            }
          );

          it("Should fail for unsupported attribute type", function() {
            const json = { "@hello": new Error("failed") };            // value is an unsupported type "Error"
            assert.throws(() => {
                DomUtil.fromJSON("root", json, "BadgerFish")
            });
        });

        it("Should fail for unsupported element type", function() {
            const json = { "hello": (x) => x+1 };            // value is an unsupported type "function"
            assert.throws(() => {
                DomUtil.fromJSON("root", json, "BadgerFish")
            });
        });

    });

    describe('fromJSON (errors)', function() {

        it("Invalid flavor", () => {
            expect(() => { DomUtil.fromJSON("root", {}, "Dummy"); }).toThrow("Invalid JSON flavor");
            // in this function "json" is not a valid flavor, it should have been transformed
            // to "BaderFish" by the caller
            expect(() => { DomUtil.fromJSON("root", {}, "json"); }).toThrow("Invalid JSON flavor");
            // XML is not a JSON flavor either
            expect(() => { DomUtil.fromJSON("root", {}, "xml"); }).toThrow("Invalid JSON flavor");
            expect(() => { DomUtil.fromJSON("root", {}, "Xml"); }).toThrow("Invalid JSON flavor");
        });

        it("No XML root", () => {
            expect(() => { DomUtil.fromJSON("", {}, "BadgerFish"); }).toThrow("no XML root name was given");
            expect(() => { DomUtil.fromJSON(null, {}, "BadgerFish"); }).toThrow("no XML root name was given");
            expect(() => { DomUtil.fromJSON(undefined, {}, "BadgerFish"); }).toThrow("no XML root name was given");
        });
        
    });

    describe('fromJSON (SimpleJson)', function() {

        function fromJSON(json) {
            var xml = DomUtil.fromJSON("root", json, "SimpleJson");
            return DomUtil.toXMLString(xml);
        }

        assert.strictEqual(fromJSON({}), '<root/>');
        assert.strictEqual(fromJSON({ "a":2, "b":"zz", "c": true }), '<root a="2" b="zz" c="true"/>');
        assert.strictEqual(fromJSON({ "a":{ x:3 } }), '<root><a x="3"/></root>');
        assert.strictEqual(fromJSON({ "$": "Hello" }), '<root>Hello</root>');
        assert.strictEqual(fromJSON({ "$a": "Hello" }), '<root><a>Hello</a></root>');
        assert.strictEqual(fromJSON({ a: { "$": "Hello" } }), '<root><a>Hello</a></root>');
        assert.strictEqual(fromJSON({ a: "World", "$a": "Hello" }), '<root a="World"><a>Hello</a></root>');
        assert.strictEqual(fromJSON({ "a": [ { "i":1 }, { "i": 2 } ] }), '<root><a i="1"/><a i="2"/></root>');
        assert.strictEqual(fromJSON({ "a": [ ] }), '<root/>');
        assert.strictEqual(fromJSON({ "a": null }), '<root/>');
        assert.strictEqual(fromJSON({ "a": undefined }), '<root/>');
    });

    describe('fromJSON (default)', function() {

        function fromJSON(json) {
            var xml = DomUtil.fromJSON("root", json);
            return DomUtil.toXMLString(xml);
        }

        assert.strictEqual(fromJSON({}), '<root/>');
        assert.strictEqual(fromJSON({ "a":2, "b":"zz", "c": true }), '<root a="2" b="zz" c="true"/>');
        assert.strictEqual(fromJSON({ "a":{ x:3 } }), '<root><a x="3"/></root>');
        assert.strictEqual(fromJSON({ "$": "Hello" }), '<root>Hello</root>');
        assert.strictEqual(fromJSON({ "$a": "Hello" }), '<root><a>Hello</a></root>');
        assert.strictEqual(fromJSON({ a: { "$": "Hello" } }), '<root><a>Hello</a></root>');
        assert.strictEqual(fromJSON({ a: "World", "$a": "Hello" }), '<root a="World"><a>Hello</a></root>');
        assert.strictEqual(fromJSON({ "a": [ { "i":1 }, { "i": 2 } ] }), '<root><a i="1"/><a i="2"/></root>');
        assert.strictEqual(fromJSON({ "a": [ ] }), '<root/>');
        assert.strictEqual(fromJSON({ "a": null }), '<root/>');
        assert.strictEqual(fromJSON({ "a": undefined }), '<root/>');
    });

    describe('toJSON (SimpleJson)', function() {

        function toJSON(xml) {
            xml = DomUtil.parse(xml);
            var json = DomUtil.toJSON(xml, "SimpleJson");
            return json;
        }

        assert.deepStrictEqual(toJSON('<root/>'), {});
        assert.deepStrictEqual(toJSON('<root a="1"/>'), { a:"1" });
        assert.deepStrictEqual(toJSON('<root a="1" b="2"/>'), { a:"1", b:"2" });
        assert.deepStrictEqual(toJSON('<root><a/></root>'), { a:{} });
        assert.deepStrictEqual(toJSON('<root><a/><a/></root>'), { a:[{},{}] });
    });

    describe('fromJSON (invalid flavor)', function() {
        try {
            DomUtil.fromJSON("root", {}, "InvalidFlavor");
            assert.fail("Should have failed");
        } catch(ex) {
            assert.ok(true);
        }
    });

    describe('toJson (errors)', function() {

        
        it("Invalid flavor", () => {
            var xml = DomUtil.parse('<root/>');
            expect(() => { DomUtil.toJSON(xml, "Dummy"); }).toThrow("Invalid JSON flavor");
            // in this function "json" is not a valid flavor, it should have been transformed
            // to "BaderFish" by the caller
            expect(() => { DomUtil.toJSON(xml, "json"); }).toThrow("Invalid JSON flavor");
            // XML is not a JSON flavor either
            expect(() => { DomUtil.toJSON(xml, "xml"); }).toThrow("Invalid JSON flavor");
            expect(() => { DomUtil.toJSON(xml, "Xml"); }).toThrow("Invalid JSON flavor");
        });
        
    });
    

    describe('toXMLString', function() {

        test.each(ref) (
            "toXMLString %p",
            (item) => {
                var expected = item.altXML || item.xml;
                var xml = DomUtil.parse(item.xml);
                xml = DomUtil.toXMLString(xml);
                assert.equal(xml, expected);
                if (item.altXML) {
                    xml = DomUtil.parse(item.altXML);
                    xml = DomUtil.toXMLString(xml);
                    assert.equal(xml, expected);
                }
            }
        );

        it("Should serialize document", () => {
            var doc = DomUtil.parse("<hello/>");
            expect(DomUtil.toXMLString(doc)).toBe("<hello/>");
        })

        it("Should serialize document if __jsdom__ is not defined", () => {
            var doc = DomUtil.parse("<hello/>");
            delete doc.__jsdom__;
            expect(DomUtil.toXMLString(doc)).toBe("<hello/>");
        })

        it("Should serialize the document element", () => {
            var doc = DomUtil.parse("<hello/>");
            expect(DomUtil.toXMLString(doc.documentElement)).toBe("<hello/>");
        })
    });

    describe('Escaping', function() {
        it('Should escape XML string', function() {
            assert.equal(DomUtil.escapeXmlString(null), null);
            assert.equal(DomUtil.escapeXmlString(undefined), undefined);
            assert.equal(DomUtil.escapeXmlString(""), "");
            assert.equal(DomUtil.escapeXmlString("Hello World"), "Hello World");
            assert.equal(DomUtil.escapeXmlString("Hello \"World\""), "Hello &quot;World&quot;");
            assert.equal(DomUtil.escapeXmlString("Hello <World>"), "Hello &lt;World&gt;");
            assert.equal(DomUtil.escapeXmlString("Hello <<World>>"), "Hello &lt;&lt;World&gt;&gt;");
            assert.equal(DomUtil.escapeXmlString("Hello&World"), "Hello&amp;World");
            assert.equal(DomUtil.escapeXmlString("Hello 'World'"), "Hello &apos;World&apos;");
        });
    });

    describe('Find elements', function() {
        it('Should find elements', function() {
            const dom = DomUtil.parse("<root><top>Hello</top>World<child><a x='1'/><b x='2'/><b x='3'/><c x='4'/></child></root>");
            const root = dom.documentElement;
            const top = DomUtil.findElement(root, "top");
            assert.ok(top !== null && top !== undefined);
            assert.equal(top.nodeName, "top");

            const child = DomUtil.findElement(root, "child");
            assert.ok(child !== null && child !== undefined);
            assert.equal(child.nodeName, "child");
            // find an element which is not the first
            const b = DomUtil.findElement(child, "b");
            assert.ok(b !== null && b !== undefined);
            assert.equal(b.nodeName, "b");
            assert.equal(b.getAttribute("x"), "2");

            // Not found
            const notFound = DomUtil.findElement(root, "notFound");
            assert.ok(notFound === null);
            assert.throws(function() {
                DomUtil.findElement(root, "notFound", true);
            });

            // Defense case
            assert.equal(DomUtil.findElement(null, "notFound"), null);
            assert.equal(DomUtil.findElement(undefined, "notFound"), null);
        });
    });

    describe('Element iterator', function() {
        it('Should support nulls', function() {
            assert.equal(DomUtil.getFirstChildElement(null), null);
            assert.equal(DomUtil.getFirstChildElement(undefined), null);
            assert.equal(DomUtil.getFirstChildElement(null, "a"), null);
            assert.equal(DomUtil.getFirstChildElement(undefined, "a"), null);

            assert.equal(DomUtil.getNextSiblingElement(null), null);
            assert.equal(DomUtil.getNextSiblingElement(undefined), null);
            assert.equal(DomUtil.getNextSiblingElement(null, "a"), null);
            assert.equal(DomUtil.getNextSiblingElement(undefined, "a"), null);
        });

        it('Should iterate over all elements', function() {
            const dom = DomUtil.parse("<root><top>Hello</top>World<child><a x='1'/><b x='2'/><b x='3'/><c x='4'/></child></root>");
            const root = dom.documentElement;
            const child = DomUtil.findElement(root, "child");
            var element = DomUtil.getFirstChildElement(child);
            assert.equal(element.nodeName, "a");
            element = DomUtil.getNextSiblingElement(element);
            assert.equal(element.nodeName, "b");
            assert.equal(element.getAttribute("x"), "2");
            element = DomUtil.getNextSiblingElement(element);
            assert.equal(element.nodeName, "b");
            assert.equal(element.getAttribute("x"), "3");
            element = DomUtil.getNextSiblingElement(element);
            assert.equal(element.nodeName, "c");
            element = DomUtil.getNextSiblingElement(element);
            assert.equal(element, null);
        });

        it('Should iterate over all elements of given name', function() {
            const dom = DomUtil.parse("<root><top>Hello</top>World<child><a x='1'/><b x='2'/><b x='3'/><c x='4'/></child></root>");
            const root = dom.documentElement;
            const child = DomUtil.findElement(root, "child");
            var element = DomUtil.getFirstChildElement(child, "b");
            assert.equal(element.nodeName, "b");
            assert.equal(element.getAttribute("x"), "2");
            element = DomUtil.getNextSiblingElement(element, "b");
            assert.equal(element.nodeName, "b");
            assert.equal(element.getAttribute("x"), "3");
            element = DomUtil.getNextSiblingElement(element, "b");
            assert.equal(element, null);
        });

        it('Should skip siblings of incorrect type', function() {
            const dom = DomUtil.parse("<root><a x='1'/><b x='2'/><c x='2'/><b x='4'/><d x='5'/></root>");     // a-b-c-b-d
            const root = dom.documentElement;
            var element = DomUtil.getFirstChildElement(root, "b");
            assert.equal(element.nodeName, "b");
            assert.equal(element.getAttribute("x"), "2");
            element = DomUtil.getNextSiblingElement(element, "b");
            assert.equal(element.nodeName, "b");
            assert.equal(element.getAttribute("x"), "4");
            element = DomUtil.getNextSiblingElement(element, "b");
            assert.equal(element, null);
        });
    });

    describe("Get content", function() {

        it("Should return element content text", function() {
            const dom = DomUtil.parse("<root>Hello World</root>");
            const root = dom.documentElement;
            assert.equal(DomUtil.elementValue(root), "Hello World");
        });

        it("Should concatenate content text", function() {
            const dom = DomUtil.parse("<root>Hello <child/>World</root>");
            const root = dom.documentElement;
            assert.equal(DomUtil.elementValue(root), "Hello World");
        });

        it("Should ignore children content text", function() {
            const dom = DomUtil.parse("<root>Hello <child>cruel </child>World</root>");
            const root = dom.documentElement;
            assert.equal(DomUtil.elementValue(root), "Hello World");
        });

        it("Should ignore CDATA elements", function() {
            const dom = DomUtil.parse("<root>Hello<![CDATA[ World]]></root>");
            const root = dom.documentElement;
            assert.equal(DomUtil.elementValue(root), "Hello World");
        });

        it("Should handle escaping in CDATA elements", function() {
            const dom = DomUtil.parse("<root>Hello<![CDATA[ <World>]]></root>");
            const root = dom.documentElement;
            assert.equal(DomUtil.elementValue(root), "Hello <World>");
        });

        it("Should handle escaping", function() {
            const dom = DomUtil.parse("<root>Hello &lt;&amp;&quot;&apos;&gt;</root>");
            const root = dom.documentElement;
            assert.equal(DomUtil.elementValue(root), "Hello <&\"'>");
        });

        it("Should support nulls", function() {
            assert.equal(DomUtil.elementValue(null), "");
            assert.equal(DomUtil.elementValue(undefined), "");
        });
    });


    describe("Get attribute values", function() {

        it("Should get string attribute value", function() {
            const dom = DomUtil.parse("<root empty='' v1='Hello' v2='&lt;World&gt;' v3='7'></root>");
            const root = dom.documentElement;
            assert.equal(DomUtil.getAttributeAsString(root, "empty"), "");
            assert.equal(DomUtil.getAttributeAsString(root, "notFound"), "");
            assert.equal(DomUtil.getAttributeAsString(root, "v1"), "Hello");
            assert.equal(DomUtil.getAttributeAsString(root, "v2"), "<World>");
            assert.equal(DomUtil.getAttributeAsString(root, "v3"), "7");
        });

        it("Should get byte attribute value", function() {
            const dom = DomUtil.parse("<root empty='' v1='Hello' v2='0' v3='1' v4='-2' v5='500'></root>");
            const root = dom.documentElement;
            assert.equal(DomUtil.getAttributeAsByte(root, "empty"), 0);
            assert.equal(DomUtil.getAttributeAsByte(root, "notFound"), 0);
            assert.equal(DomUtil.getAttributeAsByte(root, "v1"), 0);
            assert.equal(DomUtil.getAttributeAsByte(root, "v2"), 0);
            assert.equal(DomUtil.getAttributeAsByte(root, "v3"), 1);
            assert.equal(DomUtil.getAttributeAsByte(root, "v4"), -2);
            assert.equal(DomUtil.getAttributeAsByte(root, "v5"), 127);
        });

        it("Should get boolean attribute value", function() {
            const dom = DomUtil.parse("<root empty='' v1='Hello' v2='0' v3='1' v4='-2' v5='true' v6='tRuE'></root>");
            const root = dom.documentElement;
            assert.equal(DomUtil.getAttributeAsBoolean(root, "empty"), false);
            assert.equal(DomUtil.getAttributeAsBoolean(root, "notFound"), false);
            assert.equal(DomUtil.getAttributeAsBoolean(root, "v1"), false);
            assert.equal(DomUtil.getAttributeAsBoolean(root, "v2"), false);
            assert.equal(DomUtil.getAttributeAsBoolean(root, "v3"), true);
            assert.equal(DomUtil.getAttributeAsBoolean(root, "v4"), true);
            assert.equal(DomUtil.getAttributeAsBoolean(root, "v5"), true);
            assert.equal(DomUtil.getAttributeAsBoolean(root, "v6"), true);
        });

        it("Should get short attribute value", function() {
            const dom = DomUtil.parse("<root empty='' v1='Hello' v2='0' v3='1' v4='-2' v5='500'></root>");
            const root = dom.documentElement;
            expect(DomUtil.getAttributeAsShort(root, "empty")).toBe(0);
            expect(DomUtil.getAttributeAsShort(root, "notFound")).toBe(0);
            expect(DomUtil.getAttributeAsShort(root, "v1")).toBe(0);
            expect(DomUtil.getAttributeAsShort(root, "v2")).toBe(0);
            expect(DomUtil.getAttributeAsShort(root, "v3")).toBe(1);
            expect(DomUtil.getAttributeAsShort(root, "v4")).toBe(-2);
            expect(DomUtil.getAttributeAsShort(root, "v5")).toBe(500);
        });

        it("Should get long attribute value", function() {
            const dom = DomUtil.parse("<root empty='' v1='Hello' v2='0' v3='1' v4='-2' v5='500'></root>");
            const root = dom.documentElement;
            expect(DomUtil.getAttributeAsLong(root, "empty")).toBe(0);
            expect(DomUtil.getAttributeAsLong(root, "notFound")).toBe(0);
            expect(DomUtil.getAttributeAsLong(root, "v1")).toBe(0);
            expect(DomUtil.getAttributeAsLong(root, "v2")).toBe(0);
            expect(DomUtil.getAttributeAsLong(root, "v3")).toBe(1);
            expect(DomUtil.getAttributeAsLong(root, "v4")).toBe(-2);
            expect(DomUtil.getAttributeAsLong(root, "v5")).toBe(500);
        });
    });

    describe("Serialization", function() {
        it("Should serialize empty doc", function() {
            const dom = DomUtil.parse("<root></root>");
            const xml = DomUtil.toXMLString(dom);
            assert.equal(xml, "<root/>");
        });

        it("Should serialize root of empty doc", function() {
            const dom = DomUtil.parse("<root></root>");
            const xml = DomUtil.toXMLString(dom.documentElement);
            assert.equal(xml, "<root/>");
        });

        it("Should suppoort nulls", function() {
            assert.equal(DomUtil.toXMLString(null), "");
            assert.equal(DomUtil.toXMLString(undefined), "");
        });
    });


    describe("XML parsing", function() {
        it("Should parse empty document", function() {
            const dom = DomUtil.parse("<root></root>");
            assert.equal(dom.documentElement.nodeName, "root");
        });
    });


    describe("https://github.com/adobe/acc-js-sdk/issues/1", () => {
        it("Should parse empty collections", () => {
            const xml = DomUtil.parse("<root-collection></root-collection>");
            const json = DomUtil.toJSON(xml);
            expect(JSON.stringify(json)).toBe("{}");
        });

        // Root node ends with "-collection" forces the result as an array
        it("Should parse collections with exactly one element", () => {
            const xml = DomUtil.parse("<root-collection><root id='1'/></root-collection>");
            const json = DomUtil.toJSON(xml);
            expect(JSON.stringify(json)).toBe('{"root":[{"id":"1"}]}');
        });

        it("Should parse collections with more than one element", () => {
            const xml = DomUtil.parse("<root-collection><root id='1'/><root id='2'/></root-collection>");
            const json = DomUtil.toJSON(xml);
            expect(JSON.stringify(json)).toBe('{"root":[{"id":"1"},{"id":"2"}]}');
        });

        it("Should parse non-collections with exactly one element", () => {
            const xml = DomUtil.parse("<root-not-coll><root id='1'/></root-not-coll>");
            const json = DomUtil.toJSON(xml);
            expect(JSON.stringify(json)).toBe('{"root":{"id":"1"}}');
        });
        it("Should parse non-collections with more than one element", () => {
            const xml = DomUtil.parse("<root-not-coll><root id='1'/><root id='2'/></root-not-coll>");
            const json = DomUtil.toJSON(xml);
            expect(JSON.stringify(json)).toBe('{"root":[{"id":"1"},{"id":"2"}]}');
        });
    });

    describe("Text and CDATA nodes", () => {
        it("Should handle cdata node", () => {
            const xml = DomUtil.parse(`<workflow-collection><workflow id="1840" internalName="cleanup" label="Database cleanup"><desc><![CDATA[Ensure that obsolete data are deleted from the database.]]></desc></workflow></workflow-collection>`);
            const json = DomUtil.toJSON(xml);
            expect(json.workflow[0]["$desc"]).toBe("Ensure that obsolete data are deleted from the database.");
            expect(json.workflow[0]["desc"]).toBeUndefined();
        });

        it("Should handle text node", () => {
            const xml = DomUtil.parse(`<workflow-collection><workflow id="1840" internalName="cleanup" label="Database cleanup"><desc>Ensure that obsolete data are deleted from the database.</desc></workflow></workflow-collection>`);
            const json = DomUtil.toJSON(xml);
            expect(json.workflow[0]["$desc"]).toBe("Ensure that obsolete data are deleted from the database.");
            expect(json.workflow[0]["desc"]).toBeUndefined();
        });

        it("Should handle empty node", () => {
            const xml = DomUtil.parse(`<workflow-collection><workflow id="1840" internalName="cleanup" label="Database cleanup"><desc/></workflow></workflow-collection>`);
            const json = DomUtil.toJSON(xml);
            expect(json.workflow[0]["$desc"]).toBeUndefined();
            expect(json.workflow[0]["desc"]).toStrictEqual({});
        });
    });

    describe("XPath", () => {

        it("Should create XPath", () => {
            expect(new XPath("").asString()).toBe("");
            expect(new XPath(" ").asString()).toBe("");
            expect(new XPath(null).asString()).toBe("");
            expect(new XPath(undefined).asString()).toBe("");
            expect(new XPath("@name").asString()).toBe("@name");
            expect(new XPath("country/@name").asString()).toBe("country/@name");
            expect(new XPath("..").asString()).toBe("..");
            expect(new XPath(".").asString()).toBe(".");
        })

        it("Should create expanded XPath", () => {
            expect(new XPath("[@name]").asString()).toBe("@name");
            expect(new XPath("[country/@name]").asString()).toBe("country/@name");
        })

        it("toString", () => {
            expect(new XPath("").toString()).toBe("");
            expect(new XPath(" ").toString()).toBe("");
            expect(new XPath(null).toString()).toBe("");
            expect(new XPath(undefined).toString()).toBe("");
            expect(new XPath("@name").toString()).toBe("@name");
            expect(new XPath("country/@name").toString()).toBe("country/@name");
            expect(new XPath("..").toString()).toBe("..");
            expect(new XPath(".").toString()).toBe(".");
        })

        it("Should test empty XPath", () => {
            expect(new XPath("").isEmpty()).toBe(true);
            expect(new XPath(" ").isEmpty()).toBe(true);
            expect(new XPath(null).isEmpty()).toBe(true);
            expect(new XPath(undefined).isEmpty()).toBe(true);
            expect(new XPath("@name").isEmpty()).toBe(false);
            expect(new XPath("country/@name").isEmpty()).toBe(false);
            expect(new XPath("..").isEmpty()).toBe(false);
            expect(new XPath(".").isEmpty()).toBe(false);
        })

        it("Should test absolute XPath", () => {
            expect(new XPath("").isAbsolute()).toBe(false);
            expect(new XPath(" ").isAbsolute()).toBe(false);
            expect(new XPath(null).isAbsolute()).toBe(false);
            expect(new XPath(undefined).isAbsolute()).toBe(false);
            expect(new XPath("@name").isAbsolute()).toBe(false);
            expect(new XPath("country/@name").isAbsolute()).toBe(false);
            expect(new XPath("..").isAbsolute()).toBe(false);
            expect(new XPath(".").isAbsolute()).toBe(false);
            expect(new XPath("/").isAbsolute()).toBe(true);
            expect(new XPath("/country/@name").isAbsolute()).toBe(true);
        })

        it("Should test self XPath", () => {
            expect(new XPath("").isSelf()).toBe(false);
            expect(new XPath(" ").isSelf()).toBe(false);
            expect(new XPath(null).isSelf()).toBe(false);
            expect(new XPath(undefined).isSelf()).toBe(false);
            expect(new XPath("@name").isSelf()).toBe(false);
            expect(new XPath("country/@name").isSelf()).toBe(false);
            expect(new XPath("..").isSelf()).toBe(false);
            expect(new XPath(".").isSelf()).toBe(true);
            expect(new XPath("/").isSelf()).toBe(false);
            expect(new XPath("/country/@name").isSelf()).toBe(false);
        })

        it("Should test root XPath", () => {
            expect(new XPath("").isRootPath()).toBe(false);
            expect(new XPath(" ").isRootPath()).toBe(false);
            expect(new XPath(null).isRootPath()).toBe(false);
            expect(new XPath(undefined).isRootPath()).toBe(false);
            expect(new XPath("@name").isRootPath()).toBe(false);
            expect(new XPath("country/@name").isRootPath()).toBe(false);
            expect(new XPath("..").isRootPath()).toBe(false);
            expect(new XPath(".").isRootPath()).toBe(false);
            expect(new XPath("/").isRootPath()).toBe(true);
            expect(new XPath("/country/@name").isRootPath()).toBe(false);
        })

        it("Should return XPath elements", () => {

            function elements(xpath) {
                const result = [];
                const list = xpath.getElements();
                for (const e of list) {
                    result.push(e._pathElement);
                }
                return result;
            }

            expect(elements(new XPath(""))).toEqual([  ]);
            expect(elements(new XPath(" "))).toEqual([  ]);
            expect(elements(new XPath(null))).toEqual([  ]);
            expect(elements(new XPath(undefined))).toEqual([  ]);
            expect(elements(new XPath("@name"))).toEqual([ "@name" ]);
            expect(elements(new XPath("country/@name"))).toEqual([ "country", "@name" ]);
            expect(elements(new XPath(".."))).toEqual([ ".." ]);
            expect(elements(new XPath("."))).toEqual([ "." ]);
            expect(elements(new XPath("/"))).toEqual([  ]);
            expect(elements(new XPath("/country/@name"))).toEqual([ "country", "@name" ]);
        })

        it("Should get relative path", () => {
            expect(new XPath("").getRelativePath().asString()).toBe("");
            expect(new XPath(" ").getRelativePath().asString()).toBe("");
            expect(new XPath(null).getRelativePath().asString()).toBe("");
            expect(new XPath(undefined).getRelativePath().asString()).toBe("");
            expect(new XPath("@name").getRelativePath().asString()).toBe("@name");
            expect(new XPath("country/@name").getRelativePath().asString()).toBe("country/@name");
            expect(new XPath("..").getRelativePath().asString()).toBe("..");
            expect(new XPath(".").getRelativePath().asString()).toBe(".");
            expect(new XPath("/").getRelativePath().asString()).toBe("");
            expect(new XPath("/country/@name").getRelativePath().asString()).toBe("country/@name");
        })
    });

    describe("XPathElement", () => {
        it("Should create XPathElement", () => {
            expect(() => { new XPathElement(""); }).toThrow("Invalid empty xpath element");
            expect(() => { new XPathElement(" "); }).toThrow("Invalid empty xpath element");
            expect(() => { new XPathElement(null); }).toThrow("Invalid empty xpath element");
            expect(() => { new XPathElement(undefined); }).toThrow("Invalid empty xpath element");
            expect(new XPathElement("@name").asString()).toBe("@name");
            expect(new XPathElement("country").asString()).toBe("country");
            expect(new XPathElement("..").asString()).toBe("..");
            expect(new XPathElement(".").asString()).toBe(".");
        })

        it("toString", () => {
            expect(new XPathElement("@name").toString()).toBe("@name");
            expect(new XPathElement("country").toString()).toBe("country");
            expect(new XPathElement("..").toString()).toBe("..");
            expect(new XPathElement(".").toString()).toBe(".");
        })

        it("Should test if path element is self", () => {
            expect(new XPathElement("@name").isSelf()).toBe(false);
            expect(new XPathElement("country").isSelf()).toBe(false);
            expect(new XPathElement("..").isSelf()).toBe(false);
            expect(new XPathElement(".").isSelf()).toBe(true);
        })

        it("Should test if path element is the parent path (..)", () => {
            expect(new XPathElement("@name").isParent()).toBe(false);
            expect(new XPathElement("country").isParent()).toBe(false);
            expect(new XPathElement("..").isParent()).toBe(true);
            expect(new XPathElement(".").isParent()).toBe(false);
        })
    })
});
