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
 * Unit tests for the ACC client
 *
 *********************************************************************************/

const sdk = require('../src/index.js');
const { Client, ConnectionParameters } = require('../src/client.js');
const DomUtil = require('../src/domUtil.js').DomUtil;
const Mock = require('./mock.js').Mock;
const { HttpError } = require('../src/transport.js');
const { Cipher } = require('../src/crypto.js');
const { EntityAccessor } = require('../src/entityAccessor.js');
const { JSDOM } = require('jsdom');
const dom = new JSDOM();

describe('ACC Client', function () {

    describe('Init', function () {
        it('Should create client', async function () {
            const client = await Mock.makeClient();
            const NLWS = client.NLWS;
            expect(NLWS).toBeTruthy();
            expect(client.isLogged()).toBe(false);
        });

        it('Create client with invalid parameters', () => {
            // No 4th parameter should be ok
            expect(new Client(sdk, ConnectionParameters.ofUserAndPassword("http://acc-sdk:8080", "admin", "admin"))).not.toBeFalsy();
            // Object litteral is ok too
            expect(new Client(sdk, ConnectionParameters.ofUserAndPassword("http://acc-sdk:8080", "admin", "admin"), {})).not.toBeFalsy();
            expect(new Client(sdk, ConnectionParameters.ofUserAndPassword("http://acc-sdk:8080", "admin", "admin"), { representation: "BadgerFish" })).not.toBeFalsy();
            expect(new Client(sdk, ConnectionParameters.ofUserAndPassword("http://acc-sdk:8080", "admin", "admin"), { dummy: 1 })).not.toBeFalsy();
            // Boolean is not ok
            expect(() => { new Client(sdk, ConnectionParameters.ofUserAndPassword("http://acc-sdk:8080", "admin", "admin", true)); }).toThrow("An object litteral is expected");
            expect(() => { new Client(sdk, ConnectionParameters.ofUserAndPassword("http://acc-sdk:8080", "admin", "admin", false)); }).toThrow("An object litteral is expected");
            expect(() => { new Client(sdk, ConnectionParameters.ofUserAndPassword("http://acc-sdk:8080", "admin", "admin", "BadgerFish")); }).toThrow("An object litteral is expected");
            // Invalid representation is not ok
            expect(() => { new Client(sdk, ConnectionParameters.ofUserAndPassword("http://acc-sdk:8080", "admin", "admin", { representation: "Hello" })); }).toThrow("Invalid representation");
        });

        it('Should logon and logoff', async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logon();
            expect(client.isLogged()).toBe(true);
            var sessionInfoXml = client.getSessionInfo("xml");
            expect(DomUtil.findElement(sessionInfoXml, "serverInfo", true).getAttribute("buildNumber")).toBe("9219");
            await client.NLWS.xtkSession.logoff();
            expect(client.isLogged()).toBe(false);
        });

        it('Should logon and logoff with traces', async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            const logs = await Mock.withMockConsole(async () => {
                client.traceAPICalls(true);
                await client.NLWS.xtkSession.logon();
                expect(client.isLogged()).toBe(true);
                var sessionInfoXml = client.getSessionInfo("xml");
                expect(DomUtil.findElement(sessionInfoXml, "serverInfo", true).getAttribute("buildNumber")).toBe("9219");
                await client.NLWS.xtkSession.logoff();
                expect(client.isLogged()).toBe(false);
            })
            expect(logs.length).toBe(4);
            expect(logs[0]).toMatch(/SOAP.*request.*Logon/is)
            expect(logs[1]).toMatch(/SOAP.*response.*LogonResponse/is)
            expect(logs[2]).toMatch(/SOAP.*request.*Logoff/is)
            expect(logs[3]).toMatch(/SOAP.*response.*LogoffResponse/is)
        });

        it('Should fail with traces', async () => {
            const client = await Mock.makeClient();
            const logs = await Mock.withMockConsole(async () => {
                client.traceAPICalls(true);
                client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0' encoding='UTF-8'?>
                <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/' xmlns:ns='http://xml.apache.org/xml-soap'>
                    <SOAP-ENV:Body>
                        <SOAP-ENV:Fault>
                        <faultcode>faultcode</faultcode>
                        <faultstring>XXX-000000</faultstring>
                        <detail>detail</detail>
                        </SOAP-ENV:Fault>
                    </SOAP-ENV:Body>
                </SOAP-ENV:Envelope>`));
                await expect(client.NLWS.xtkSession.logon()).rejects.toMatchObject({ errorCode: "XXX-000000" });
            });
            expect(logs.length).toBe(2);
            expect(logs[0]).toMatch(/SOAP.*request.*Logon/is)
            expect(logs[1]).toMatch(/SOAP.*failure.*500.*XXX-000000/is)
        });

        it('Should logon and logoff (remember me)', async () => {
            const client = await Mock.makeClient({ rememberMe: true });

            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            expect(client.isLogged()).toBe(true);
            var sessionInfoXml = client.getSessionInfo("xml");
            expect(DomUtil.findElement(sessionInfoXml, "serverInfo", true).getAttribute("buildNumber")).toBe("9219");

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
            expect(client.isLogged()).toBe(false);
        });

        it("Should support multiple logoff", async () => {
            const client = await Mock.makeClient();
            await client.NLWS.xtkSession.logoff();
            expect(client.isLogged()).toBe(false);
            await client.NLWS.xtkSession.logoff();
            expect(client.isLogged()).toBe(false)
        });

        it('Should fail to call if unlogged', async () => {
            const client = await Mock.makeClient();
            await expect(client.getSchema("nms:recipient")).rejects.toMatchObject({ errorCode: "SDK-000010" });
        });

        it('Should fail if logon does not return a session token', async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE_NO_SESSIONTOKEN);
            await expect(client.NLWS.xtkSession.logon()).rejects.toMatchObject({ errorCode: "SDK-000007" });
            expect(client.isLogged()).toBe(false);
        });

        it('Should fail if logon does not return a security token', async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE_NO_SECURITYTOKEN);
            await expect(client.NLWS.xtkSession.logon()).rejects.toMatchObject({ errorCode: "SDK-000007" });
            expect(client.isLogged()).toBe(false);
        });

        it('Should logon with dummy cookie', async () => {
            /* eslint no-global-assign: "off" */
            document = {};
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            expect(client.isLogged()).toBe(true);
            var sessionInfoXml = client.getSessionInfo("xml");
            expect(DomUtil.findElement(sessionInfoXml, "serverInfo", true).getAttribute("buildNumber")).toBe("9219");
            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
            expect(client.isLogged()).toBe(false);
            document = undefined;
        });

        it('Should fail if Logon does not return an UserInfo struture', async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE_NO_USERINFO);
            await expect(client.NLWS.xtkSession.logon()).rejects.toMatchObject({ errorCode: "SDK-000007" });
            expect(client.isLogged()).toBe(false);
        });

        it('Should fail with invalid credentials type', async () => {
            const client = await Mock.makeClient();
            client._connectionParameters._credentials._type = "Dummy";
            await expect(client.logon()).rejects.toMatchObject({ errorCode: 'SDK-000000' });
        })

        it('Should not crash if calling isLogged on uninitialized client', () => {
            const client = new Client(sdk, { _options: {} });
            expect(client.isLogged()).toBeFalsy();
        })
    });

    describe("Get session Info", () => {

        it('Should get session info with default representation', async () => {
            const client = await Mock.makeClient({ rememberMe: true });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            var sessionInfo = client.getSessionInfo();
            expect(sessionInfo.serverInfo.buildNumber).toBe("9219");
        });

        it('Should get session info with BadgerFish representation', async () => {
            const client = await Mock.makeClient({ rememberMe: true });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            var sessionInfo = client.getSessionInfo("BadgerFish");
            expect(sessionInfo.serverInfo['@buildNumber']).toBe("9219");
        });

    })

    describe('API calls', () => {
        it('Should getEntityIfMoreRecent', async () => {
            const client = await Mock.makeClient({ representation: "xml" });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logon();
            const schema = await client.getEntityIfMoreRecent("xtk:schema", "xtk:session");
            var element = DomUtil.getFirstChildElement(schema);
            expect(element.nodeName).toBe("interface");
            expect(element.getAttribute("name")).toBe("persist");
            element = DomUtil.getNextSiblingElement(element);
            expect(element.nodeName).toBe("element");
            expect(element.getAttribute("name")).toBe("sessionInfo");
            element = DomUtil.getNextSiblingElement(element);
            expect(element.nodeName).toBe("element");
            expect(element.getAttribute("name")).toBe("userInfo");
            element = DomUtil.getNextSiblingElement(element);
            expect(element.nodeName).toBe("element");
            expect(element.getAttribute("name")).toBe("session");
            await client.NLWS.xtkSession.logoff();
        });

        it('Should getOption', async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            await client.NLWS.xtkSession.logon();

            // Method 1: convenience function
            client._transport.mockReturnValueOnce(Mock.GET_DATABASEID_RESPONSE);
            var databaseId = await client.getOption("XtkDatabaseId");
            expect(databaseId).toBe("uFE80000000000000F1FA913DD7CC7C480041161C");
            // Method 2 : SOAP call - will not use cache to get, but will cache result
            client._transport.mockReturnValueOnce(Mock.GET_DATABASEID_RESPONSE);
            var option = await client.NLWS.xtkSession.getOption("XtkDatabaseId");
            expect(option[0]).toBe("uFE80000000000000F1FA913DD7CC7C480041161C");
            expect(option[1]).toBe(6);
            // Call again => should not perform any SOAP calls as its using the
            // cache for both the schema and the option
             databaseId = await client.getOption("XtkDatabaseId");
            expect(databaseId).toBe("uFE80000000000000F1FA913DD7CC7C480041161C");
            // Force not using cache
            client._transport.mockReturnValueOnce(Mock.GET_DATABASEID_RESPONSE);
             databaseId = await client.getOption("XtkDatabaseId", false);
            expect(databaseId).toBe("uFE80000000000000F1FA913DD7CC7C480041161C");
            // Clear cache
            client.clearOptionCache();
            client._transport.mockReturnValueOnce(Mock.GET_DATABASEID_RESPONSE);
             databaseId = await client.getOption("XtkDatabaseId");
            expect(databaseId).toBe("uFE80000000000000F1FA913DD7CC7C480041161C");

            // Without parameters
            await client.NLWS.xtkSession.getOption().catch(e => {
                expect(e.name).toMatch('Error');
            });

            // representations
            client._representation = "json";
            client._transport.mockReturnValueOnce(Mock.GET_DATABASEID_RESPONSE);
            option = await client.NLWS.xtkSession.getOption("XtkDatabaseId");
            expect(option[0]).toBe("uFE80000000000000F1FA913DD7CC7C480041161C");
            expect(option[1]).toBe(6);

            client._representation = "xml";
            client._transport.mockReturnValueOnce(Mock.GET_DATABASEID_RESPONSE);
            option = await client.NLWS.xtkSession.getOption("XtkDatabaseId");
            expect(option[0]).toBe("uFE80000000000000F1FA913DD7CC7C480041161C");
            expect(option[1]).toBe(6);

            client._representation = "invalid";
            option = await client.NLWS.xtkSession.getOption("XtkDatabaseId").catch(e => {
                expect(e.name).toMatch('Error');
            });

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });


        describe("Should set option", () => {

            it("Should set option when it does not exist", async () => {
                const client = await Mock.makeClient();
                client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
                client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
                await client.NLWS.xtkSession.logon();

                // Setting an option for the first time will
                // - try to read the option from the database (as it's not in cache yet): xtk:session#GetOption
                // - use a writer to write the result to the database
                client._transport.mockReturnValueOnce(Mock.GET_OPTION_NOTFOUND_RESPONSE);
                client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0'?>
                            <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:wpp:default' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
                            <SOAP-ENV:Body>
                            <WriteResponse xmlns='urn:wpp:default' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                            </WriteResponse>
                            </SOAP-ENV:Body>
                            </SOAP-ENV:Envelope>`));
                await client.setOption("XtkDatabaseId", "ABC");
                // Reading the option should not make any database access and read from the cache
                var databaseId = await client.getOption("XtkDatabaseId");
                expect(databaseId).toBe("ABC");
            })

            it("Should set option with description", async () => {
                const client = await Mock.makeClient();
                client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
                client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
                await client.NLWS.xtkSession.logon();

                // Setting an option for the first time will
                // - try to read the option from the database (as it's not in cache yet): xtk:session#GetOption
                // - use a writer to write the result to the database
                client._transport.mockReturnValueOnce(Mock.GET_OPTION_NOTFOUND_RESPONSE);
                client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0'?>
                            <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:wpp:default' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
                            <SOAP-ENV:Body>
                            <WriteResponse xmlns='urn:wpp:default' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                            </WriteResponse>
                            </SOAP-ENV:Body>
                            </SOAP-ENV:Envelope>`));
                await client.setOption("XtkDatabaseId", "ABC", "This is my desc");
                // Reading the option should not make any database access and read from the cache
                var databaseId = await client.getOption("XtkDatabaseId");
                expect(databaseId).toBe("ABC");
            })

            it("Should set existing option with type", async () => {
                const client = await Mock.makeClient();
                client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
                client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
                await client.NLWS.xtkSession.logon();

                // Setting an option for the first time will
                // - try to read the option from the database (as it's not in cache yet): xtk:session#GetOption. In this case, it will return a numeric option
                // - use a writer to write the result to the database
                client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0'?>
                        <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:xtk:session' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
                        <SOAP-ENV:Body>
                            <GetOptionResponse xmlns='urn:xtk:session' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                                <pstrValue xsi:type='xsd:string'>-123</pstrValue>
                                <pbtType xsi:type='xsd:byte'>3</pbtType>
                            </GetOptionResponse>
                        </SOAP-ENV:Body>
                        </SOAP-ENV:Envelope>`));
                client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0'?>
                            <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:wpp:default' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
                            <SOAP-ENV:Body>
                            <WriteResponse xmlns='urn:wpp:default' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                            </WriteResponse>
                            </SOAP-ENV:Body>
                            </SOAP-ENV:Envelope>`));
                await client.setOption("XtkDatabaseId", "7");
                // Reading the option should not make any database access and read from the cache
                var databaseId = await client.getOption("XtkDatabaseId");
                expect(databaseId).toBe(7);
            })

        })

        it("Should return missing options", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            // Get missing option
            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_OPTION_NOTFOUND_RESPONSE);
            var value = await client.getOption("ZZ");
            expect(value).toBeNull();

            // Check missing option is cached too
            value = await client.getOption("ZZ");
            expect(value).toBeNull();

            // Defense case where resulting parameters are missing. This is a forged answer, should not happen
            // in reality
            client._transport.mockReturnValueOnce(Mock.GET_OPTION_MISSING_DATA_RESPONSE);
            await client.getOption("YY").catch(e => {
                expect(e.statusCode).toBe(400);
                expect(e.faultCode).toMatch('Missing parameter for method');
            });
        });

        it("Should return schema definition", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_NMS_EXTACCOUNT_SCHEMA_RESPONSE);
            var schema = await client.getSchema("nms:extAccount");
            expect(schema["namespace"]).toBe("nms");
            expect(schema["name"]).toBe("extAccount");

            // Ask again, should use cache
            schema = await client.getSchema("nms:extAccount");
            expect(schema["namespace"]).toBe("nms");
            expect(schema["name"]).toBe("extAccount");

            // Clear cache and ask again
            client.clearEntityCache();
            client._transport.mockReturnValueOnce(Mock.GET_NMS_EXTACCOUNT_SCHEMA_RESPONSE);
            schema = await client.getSchema("nms:extAccount");
            expect(schema["namespace"]).toBe("nms");
            expect(schema["name"]).toBe("extAccount");

            // Ask as XML
            schema = await client.getSchema("nms:extAccount", "xml");
            expect(schema.getAttribute("namespace")).toBe("nms");
            expect(schema.getAttribute("name")).toBe("extAccount");

            // Ask as BadgerFish
            schema = await client.getSchema("nms:extAccount", "BadgerFish");
            expect(schema["@namespace"]).toBe("nms");
            expect(schema["@name"]).toBe("extAccount");

            // Ask with invalid representation
            await expect(client.getSchema("nms:extAccount", "invalid")).rejects.toMatchObject({ errorCode: 'SDK-000004' });

            // Get missing schema
            client.clearAllCaches();
            client._transport.mockReturnValueOnce(Mock.GET_MISSING_SCHEMA_RESPONSE);
            schema = await client.getSchema("nms:dummy", "BadgerFish");
            expect(schema).toBeNull();
            client.clearAllCaches();
            client._transport.mockReturnValueOnce(Mock.GET_MISSING_SCHEMA_RESPONSE);
            schema = await client.getSchema("nms:dummy", "xml");
            expect(schema).toBeNull();

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });

        it("Should return sys enum definition", async () => {
            const client = await Mock.makeClient({ representation: "BadgerFish" });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_NMS_EXTACCOUNT_SCHEMA_RESPONSE);
            var sysEnum = await client.getSysEnum("nms:extAccount:encryptionType");
            expect(sysEnum["@basetype"]).toBe("byte");
            expect(sysEnum["@name"]).toBe("encryptionType");
            expect(sysEnum.value[0]["@name"]).toBe("none");
            expect(sysEnum.value[1]["@name"]).toBe("ssl");

            // Find sysEnum by relative name
            sysEnum = await client.getSysEnum("encryptionType", "nms:extAccount");
            expect(sysEnum["@basetype"]).toBe("byte");
            expect(sysEnum["@name"]).toBe("encryptionType");
            expect(sysEnum.value[0]["@name"]).toBe("none");
            expect(sysEnum.value[1]["@name"]).toBe("ssl");

            // Schema name should be valid, i.e. "nms:extAccount" and not "extAccount"
            await expect(client.getSysEnum("encryptionType", "extAccount")).rejects.toMatchObject({ errorCode: "SDK-000006" });
            // Schema name must be a string
            await expect(client.getSysEnum("encryptionType", new Date())).rejects.toMatchObject({ errorCode: "SDK-000006" });
            // With one parameter, enum name must be fully qualified, i.e. "nms:extAccount:encryptionType"
            await expect(client.getSysEnum("encryptionType")).rejects.toMatchObject({ errorCode: "SDK-000006" });
            await expect(client.getSysEnum("extAccount:encryptionType")).rejects.toMatchObject({ errorCode: "SDK-000006" });

            // Enum does not exist
            sysEnum = await client.getSysEnum("nms:extAccount:notFound");
            expect(sysEnum).toBeUndefined();

            // Get cached XML representation
            client._representation = "xml";
            sysEnum = await client.getSysEnum("nms:extAccount:encryptionType");
            expect(sysEnum.getAttribute("basetype")).toBe("byte");

            // Invalid representation
            const startSchema = await client.getSchema("nms:extAccount");
            client._representation = "invalid";
            await expect(client.getSysEnum("encryptionType", startSchema)).rejects.toMatchObject({ errorCode: "SDK-000006" });
            client._representation = "xml";

            // Get non-cached XML representation
            client.clearAllCaches();
            client._transport.mockReturnValueOnce(Mock.GET_NMS_EXTACCOUNT_SCHEMA_RESPONSE);
            sysEnum = await client.getSysEnum("nms:extAccount:encryptionType");
            expect(sysEnum.getAttribute("basetype")).toBe("byte");

            // Schema does not exist
            client.clearAllCaches();
            client._transport.mockReturnValueOnce(Mock.GET_MISSING_SCHEMA_RESPONSE);
            await expect(client.getSysEnum("nms:dummy:encryptionType")).rejects.toMatchObject({ errorCode: "SDK-000006" });

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });

        it("getSysEnum should support schemas which do not have enumerations (BadgerFish representation)", async () => {
            const client = await Mock.makeClient();
            client._representation = "BadgerFish";
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_XTK_ALL_SCHEMA_RESPONSE);
            var sysEnum = await client.getSysEnum("xtk:all:encryptionType");
            expect(sysEnum).toBeUndefined();
        });

        it("getSysEnum should support schemas which do not have enumerations (XML representation)", async () => {
            const client = await Mock.makeClient();
            client._representation = "xml";
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_XTK_ALL_SCHEMA_RESPONSE);
            var sysEnum = await client.getSysEnum("xtk:all:encryptionType");
            expect(sysEnum).toBeUndefined();
        });

        it("getSysEnum should support schemas which do not have enumerations (SimpleJson representation)", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_XTK_ALL_SCHEMA_RESPONSE);
            var sysEnum = await client.getSysEnum("xtk:all:encryptionType");
            expect(sysEnum).toBeUndefined();
        });

        it("getSysEnum should fail if schema not found", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_XTK_ALL_SCHEMA_RESPONSE);
            await expect(client.getSysEnum(":")).rejects.toMatchObject({ errorCode: "SDK-000006" });
        });

        it("getSysEnum should fail on invalid representation)", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_XTK_ALL_SCHEMA_RESPONSE);
            await client.getSysEnum("xtk:all:encryptionType"); // cache schema before setting invalid representation
            client._representation = "Dummy";
            await expect(client.getSysEnum("xtk:all:encryptionType")).rejects.toMatchObject({ errorCode: "SDK-000004" });
        });

    });

    describe("Should return sys enum definition with the right representation", () => {
        it("Should return sys enum definition with the default representation", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_NMS_EXTACCOUNT_SCHEMA_RESPONSE);
            var sysEnum = await client.getSysEnum("nms:extAccount:encryptionType");
            expect(sysEnum["basetype"]).toBe("byte");
            expect(sysEnum["name"]).toBe("encryptionType");
            expect(sysEnum.value[0]["name"]).toBe("none");
            expect(sysEnum.value[1]["name"]).toBe("ssl");
        });

        it("Should return sys enum definition with the 'BadgerFish' representation", async () => {
            const client = await Mock.makeClient({ representation: "BadgerFish" });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_NMS_EXTACCOUNT_SCHEMA_RESPONSE);
            var sysEnum = await client.getSysEnum("nms:extAccount:encryptionType");
            expect(sysEnum["@basetype"]).toBe("byte");
            expect(sysEnum["@name"]).toBe("encryptionType");
            expect(sysEnum.value[0]["@name"]).toBe("none");
            expect(sysEnum.value[1]["@name"]).toBe("ssl");
        });

        it("Should return sys enum definition with the 'SimpleJson' representation", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_NMS_EXTACCOUNT_SCHEMA_RESPONSE);
            var sysEnum = await client.getSysEnum("nms:extAccount:encryptionType");
            expect(sysEnum["basetype"]).toBe("byte");
            expect(sysEnum["@basetype"]).toBeUndefined();
            expect(sysEnum["name"]).toBe("encryptionType");
            expect(sysEnum.value[0]["name"]).toBe("none");
            expect(sysEnum.value[1]["name"]).toBe("ssl");
        });

        it("Should return sys enum definition with the 'xml' representation", async () => {
            const client = await Mock.makeClient({ representation: "xml" });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_NMS_EXTACCOUNT_SCHEMA_RESPONSE);
            var sysEnum = await client.getSysEnum("nms:extAccount:encryptionType");
            expect(sysEnum.getAttribute("basetype")).toBe("byte");
            expect(sysEnum.getAttribute("name")).toBe("encryptionType");
            var value = DomUtil.getFirstChildElement(sysEnum, "value");
            expect(value.getAttribute("name")).toBe("none");
            value = DomUtil.getNextSiblingElement(value);
            expect(value.getAttribute("name")).toBe("ssl");
        });
    });

    describe("Get Mid Client", () => {

        it("Should get mid connection", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            const key = Mock.makeKey();
            const encrypted = new Cipher(key).encryptPassword("mid");

            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_MID_EXT_ACCOUNT_RESPONSE(encrypted));
            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_SECRET_KEY_OPTION_RESPONSE(key));
            var connectionParameters = await sdk.ConnectionParameters.ofExternalAccount(client, "defaultEmailMid");
            var midClient = await sdk.init(connectionParameters);
            midClient._transport = jest.fn();

            midClient._transport.mockReturnValueOnce(Mock.GET_LOGON_MID_RESPONSE);
            await midClient.NLWS.xtkSession.logon();

            midClient._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            midClient._transport.mockReturnValueOnce(Mock.GET_TSTCNX_RESPONSE);
            await midClient.NLWS.xtkSession.testCnx();

            midClient._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await midClient.NLWS.xtkSession.logoff();
            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });

        it("Should fail to get connection for external account which is not a mid-sourcing account", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            const key = Mock.makeKey();
            const encrypted = new Cipher(key).encryptPassword("mid");

            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_BAD_EXT_ACCOUNT_RESPONSE(encrypted));
            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_SECRET_KEY_OPTION_RESPONSE(key));
            await expect(async () => {
                return sdk.ConnectionParameters.ofExternalAccount(client, "bad");
            }).rejects.toMatchObject({ errorCode: "SDK-000005" });
        })

        it("Should fail if invalid representation", async () => {
            const client = await Mock.makeClient();
            const key = Mock.makeKey();
            const encrypted = new Cipher(key).encryptPassword("mid");

            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_MID_EXT_ACCOUNT_RESPONSE(encrypted));
            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_SECRET_KEY_OPTION_RESPONSE(key));

            await expect(async () => {
                client._representation = "Dummy";
                var connectionParameters = await sdk.ConnectionParameters.ofExternalAccount(client, "defaultEmailMid");
                return sdk.init(connectionParameters);
            }).rejects.toMatchObject({ errorCode: "SDK-000004" });
        });

        // getMidClient internally uses an object encoded in BadgerFish
        // => explicitely test with another representation
        it("Should fail not fail with SimpleJson representation", async () => {
            const client = await Mock.makeClient();
            client._representation = "SimpleJson";
            const key = Mock.makeKey();
            const encrypted = new Cipher(key).encryptPassword("mid");

            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_MID_EXT_ACCOUNT_RESPONSE(encrypted));
            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_SECRET_KEY_OPTION_RESPONSE(key));

            var connectionParameters = await sdk.ConnectionParameters.ofExternalAccount(client, "defaultEmailMid");
            await sdk.init(connectionParameters);
        });

        it("Should get cached cipher", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            const key = Mock.makeKey();

            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_SECRET_KEY_OPTION_RESPONSE(key));
            var cipher = await client._getSecretKeyCipher();
            expect(cipher).not.toBeNull();
            expect(cipher.key).not.toBeNull();
            expect(cipher.iv).not.toBeNull();

            // Ask again, should be cached (no mock methods)
            client.clearAllCaches();
            cipher = await client._getSecretKeyCipher();
            expect(cipher).not.toBeNull();
            expect(cipher.key).not.toBeNull();
            expect(cipher.iv).not.toBeNull();

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });
    });


    describe("SOAP call with all parameters and return types", () => {

        it("Should call with all parameter types", async () => {
            const client = await Mock.makeClient({ representation: "BadgerFish" });

            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_XTK_ALL_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_XTK_ALL_TYPES_RESPONSE);

            const element = { "@type": "element", "@xtkschema": "nms:recipient" };          // @xtkschema needed to determine root name
            const document = { "@type": "document", "@xtkschema": "nms:recipient" };

            const result = await client.NLWS.xtkAll.allTypes("Hello World", true, 1, 1000, 100000, "100000", "2020-12-31T12:34:56.789Z", "2020-12-31", element, document);
            // Note: should match responses in GET_XTK_ALL_TYPES_RESPONSE
            expect(result.length).toBe(10);
            expect(result[0]).toBe("Hello World");
            expect(result[1]).toBe(true);
            expect(result[2]).toBe(1);
            expect(result[3]).toBe(1000);
            expect(result[4]).toBe(100000);
            expect(result[5]).toBe("100000");
            expect(result[6].toISOString()).toBe("2020-12-31T12:34:56.789Z");
            expect(result[7].toISOString()).toBe("2020-12-31T00:00:00.000Z");
            expect(result[8]["@type"]).toBe("element");
            expect(result[8]["@result"]).toBe("true");
            expect(result[9]["@type"]).toBe("document");
            expect(result[9]["@result"]).toBe("true");

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });

        it("Should check xtkschema attribute", async () => {
            const client = await Mock.makeClient();

            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_XTK_ALL_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_XTK_ALL_TYPES_RESPONSE);

            const element = { "@type": "element" };          // @xtkschema needed to determine root name, missing on purpose
            const document = { "@type": "document", "@xtkschema": "nms:recipient" };

            await client.NLWS.xtkAll.allTypes("Hello World", true, 1, 1000, 100000, "2020-12-31T12:34:56.789Z", "2020-12-31", element, document).catch(e => {
                expect(e.name).toMatch('Error');
            });

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });
        it("Should fail on unsupported type", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_XTK_ALL_SCHEMA_RESPONSE);

            // unsupported input parameter
            await expect(client.NLWS.xtkAll.unsupportedInput()).rejects.toMatchObject({ errorCode: "SDK-000008" });

            // unsupported output parameter
            client._transport.mockReturnValueOnce(Mock.GET_XTK_TYPE_UNSUPPORTED_TYPE_RESPONSE);
            await expect(client.NLWS.xtkAll.unsupported()).rejects.toMatchObject({ errorCode: "SDK-000007" });

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });

        it("Should support local return type", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_USER_INFO_RESPONSE);
            const userInfo = await client.NLWS.xtkSession.getUserInfo();
            expect(userInfo["login"]).toBe("admin");

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });

        it("Should support XML representation", async () => {
            const client = await Mock.makeClient({ representation: "xml" });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_USER_INFO_RESPONSE);
            const userInfo = await client.NLWS.xtkSession.getUserInfo();
            expect(userInfo.getAttribute("login")).toBe("admin");

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });

        it("Should fail if schema does not exist", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_MISSING_SCHEMA_RESPONSE);
            await expect(client.NLWS.xtkNotFound.unsupported()).rejects.toMatchObject({ errorCode: "SDK-000009" });

            // Call directly
            client._transport.mockReturnValueOnce(Mock.GET_MISSING_SCHEMA_RESPONSE);
            const callContext = { schemaId: "xtk:notFound" };
            await expect(client._callMethod("dummy", callContext)).rejects.toMatchObject({ errorCode: "SDK-000009" });

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });

        it("Should fail if method does not exist", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            await expect(client.NLWS.xtkSession.unsupported()).rejects.toMatchObject({ errorCode: "SDK-000009" });

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });

        it("Should fail if calling non static function without object", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            await expect(client.NLWS.xtkSession.nonStatic()).rejects.toMatchObject({ errorCode: "SDK-000009" });

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });

        it("Should start workflow (hack)", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_XTK_WORKFLOW_SCHEMA_RESPONSE);
            client._transport.mockImplementationOnce(options => {
                const doc = DomUtil.parse(options.data);
                const body = DomUtil.findElement(doc.documentElement, "SOAP-ENV:Body");
                const method = DomUtil.getFirstChildElement(body);
                const parameters = DomUtil.findElement(method, "parameters");
                const variables = DomUtil.getFirstChildElement(parameters, "variables");
                if (!variables)
                    throw new Error("Did not find 'variables' node");
                if (variables.getAttribute("hello") != "world")
                    throw new Error("Did not find 'hello' variable");

                return Promise.resolve(`<?xml version='1.0'?>
                    <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:xtk:workflow' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
                        <SOAP-ENV:Body>
                        <StartWithParametersResponse xmlns='urn:xtk:workflow' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                        </StartWithParametersResponse>
                        </SOAP-ENV:Body>
                    </SOAP-ENV:Envelope>`);
            });
            await client.NLWS.xtkWorkflow.startWithParameters(4900, { "hello": "world" });

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });

        it("Should call non static method", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_QUERY_EXECUTE_RESPONSE);
            var queryDef = {
                "schema": "nms:extAccount",
                "operation": "select",
                "select": {
                    "node": [
                        { "expr": "@id" },
                        { "expr": "@name" }
                    ]
                }
            };
            var query = client.NLWS.xtkQueryDef.create(queryDef);
            await query.executeQuery();

            queryDef = DomUtil.parse(`<queryDef schema="nms:extAccount" operation="select">
                    <select>
                        <node expr="@id"/>
                        <node expr="@name"/>
                    </select>
                </queryDef>`);
            client._representation = "xml";
            client._transport.mockReturnValueOnce(Mock.GET_QUERY_EXECUTE_RESPONSE);
            query = client.NLWS.xtkQueryDef.create(queryDef);
            await query.executeQuery();

            client._representation = "invalid";
            client.NLWS.xtkQueryDef.create(queryDef)
            await expect(async () => {
                return query.executeQuery();
            }).rejects.toMatchObject({ errorCode: "SDK-000004" });

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();

        });

        it("Should fail to return DOMDocument with unsupported representation", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);

            client._transport.mockReturnValueOnce(Mock.GET_GETDOCUMENT_RESPONSE);
            client._representation = "xml";
            await client.NLWS.xtkPersist.getDocument();

            client._transport.mockReturnValueOnce(Mock.GET_GETDOCUMENT_RESPONSE);
            client._representation = "invalid";
            await expect(async() => {
                return client.NLWS.xtkPersist.getDocument();
            }).rejects.toMatchObject({ errorCode: "SDK-000004" });

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });

        it("Should fail to return DOMElement with unsupported representation", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);

            client._transport.mockReturnValueOnce(Mock.GET_GETELEMENT_RESPONSE);
            client._representation = "xml";
            await client.NLWS.xtkPersist.getElement();

            client._transport.mockReturnValueOnce(Mock.GET_GETELEMENT_RESPONSE);
            client._representation = "invalid";
            await expect(async() => {
                return client.NLWS.xtkPersist.getElement();
            }).rejects.toMatchObject({ errorCode: "SDK-000004" });

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });

        it("Should fail to pass DOMDocument with unsupported representation", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);

            const document = DomUtil.parse("<root/>");
            client._transport.mockReturnValueOnce(Mock.GET_SETDOCUMENT_RESPONSE);
            client._representation = "xml";
            await client.NLWS.xtkPersist.setDocument(document);

            client._transport.mockReturnValueOnce(Mock.GET_SETDOCUMENT_RESPONSE);
            client._representation = "invalid";
            await expect(async() => {
                return client.NLWS.xtkPersist.setDocument(document);
            }).rejects.toMatchObject({ errorCode: "SDK-000004" });

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });


        it("Should fail to pass DOMElement with unsupported representation", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);

            const element = DomUtil.parse("<root/>").documentElement;
            client._transport.mockReturnValueOnce(Mock.GET_SETELEMENT_RESPONSE);
            client._representation = "xml";
            await client.NLWS.xtkPersist.setElement(element);

            client._transport.mockReturnValueOnce(Mock.GET_SETELEMENT_RESPONSE);
            client._representation = "invalid";
            await expect(async() => {
                return client.NLWS.xtkPersist.setElement(element);
            }).rejects.toMatchObject({ errorCode: "SDK-000004" });

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });

        it("Should support mutable calls", async () => {
            // Some methods can mutate the object on which they apply. This is for instance the case of the xtk:queryDef#SelectAll method.
            // You call it on a queryDef, and it internally returns a new query definition which contain select nodes for all the nodes of the schema.
            // When such a method is called, the SDK will know how to "mutate" the corresponding object.
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            var queryDef = {
                "schema": "xtk:option",
                "operation": "getIfExists",
            };
            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            var query = client.NLWS.xtkQueryDef.create(queryDef);

            client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0'?>
                    <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:xtk:queryDef' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
                    <SOAP-ENV:Body>
                    <SelectAllResponse xmlns='urn:xtk:queryDef' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                        <entity xsi:type='ns:Element' SOAP-ENV:encodingStyle='http://xml.apache.org/xml-soap/literalxml'>
                            <queryDef operation="get" schema="xtk:option" startPath="/" xtkschema="xtk:queryDef">
                            <select>
                            <node expr="@id" noComputeString="true"/>
                            <node expr="@name" noComputeString="true"/>
                            <node expr="@type" noComputeString="true"/>
                            <node anyType="true" expr="desc" noComputeString="true"/>
                            <node expr="@dataType" noComputeString="true"/>
                            <node expr="@stringValue" noComputeString="true"/>
                            <node expr="@longValue" noComputeString="true"/>
                            <node expr="@doubleValue" noComputeString="true"/>
                            <node expr="@timeStampValue" noComputeString="true"/>
                            <node anyType="true" expr="memoValue" noComputeString="true"/>
                            <node expr="[@createdBy-id]" noComputeString="true"/>
                            <node expr="[@modifiedBy-id]" noComputeString="true"/>
                            <node expr="@created" noComputeString="true"/>
                            <node expr="@lastModified" noComputeString="true"/>
                            </select>
                            </queryDef>
                        </entity>
                    </SelectAllResponse>
                    </SOAP-ENV:Body>
                    </SOAP-ENV:Envelope>`));
            await query.selectAll(false);

            // Check that query has new nodes
            const object = query.inspect();         // JSON query object
            expect(object.select.node.length).toBe(14);
        })

    });

    // Fails to use xtk:persist unless xtk:session loaded before

    describe("Issue #3", () => {

        it("getIfExists with empty result", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);

            client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0'?>
            <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:xtk:queryDef' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
            <SOAP-ENV:Body>
            <ExecuteQueryResponse xmlns='urn:xtk:queryDef' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                <pdomOutput xsi:type='ns:Element' SOAP-ENV:encodingStyle='http://xml.apache.org/xml-soap/literalxml'>
                <extAccount/>
                </pdomOutput></ExecuteQueryResponse>
            </SOAP-ENV:Body>
            </SOAP-ENV:Envelope>`));

            var queryDef = {
                "schema": "nms:extAccount",
                "operation": "getIfExists",
                "select": {
                    "node": [
                        { "expr": "@id" },
                        { "expr": "@name" }
                    ]
                }
            };

            // GetIfExists should return null
            var query = client.NLWS.xtkQueryDef.create(queryDef);
            var extAccount = await query.executeQuery();
            expect(extAccount).toBeNull();
        });

        it("select with empty result", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);

            client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0'?>
            <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:xtk:queryDef' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
            <SOAP-ENV:Body>
            <ExecuteQueryResponse xmlns='urn:xtk:queryDef' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                <pdomOutput xsi:type='ns:Element' SOAP-ENV:encodingStyle='http://xml.apache.org/xml-soap/literalxml'>
                <extAccount-collection/>
                </pdomOutput></ExecuteQueryResponse>
            </SOAP-ENV:Body>
            </SOAP-ENV:Envelope>`));

            var queryDef = {
                "schema": "nms:extAccount",
                "operation": "select",
                "select": {
                    "node": [
                        { "expr": "@id" },
                        { "expr": "@name" }
                    ]
                }
            };

            // Select should return empty array
            var query = client.NLWS.xtkQueryDef.create(queryDef);
            var extAccount = await query.executeQuery();
            expect(extAccount).toEqual({ extAccount: [] });
        });

        it("getIfExists with a result of exactly one element", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);

            client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0'?>
            <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:xtk:queryDef' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
            <SOAP-ENV:Body>
            <ExecuteQueryResponse xmlns='urn:xtk:queryDef' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                <pdomOutput xsi:type='ns:Element' SOAP-ENV:encodingStyle='http://xml.apache.org/xml-soap/literalxml'>
                <extAccount id="1"/>
                </pdomOutput></ExecuteQueryResponse>
            </SOAP-ENV:Body>
            </SOAP-ENV:Envelope>`));

            var queryDef = {
                "schema": "nms:extAccount",
                "operation": "getIfExists",
                "select": {
                    "node": [
                        { "expr": "@id" },
                        { "expr": "@name" }
                    ]
                }
            };

            // GetIfExists should return element
            var query = client.NLWS.xtkQueryDef.create(queryDef);
            var extAccount = await query.executeQuery();
            expect(extAccount).toEqual({ "id": "1" });
        });

        it("select with a result of exactly one element", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);

            client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0'?>
            <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:xtk:queryDef' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
            <SOAP-ENV:Body>
            <ExecuteQueryResponse xmlns='urn:xtk:queryDef' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                <pdomOutput xsi:type='ns:Element' SOAP-ENV:encodingStyle='http://xml.apache.org/xml-soap/literalxml'>
                <extAccount-collection><extAccount id="1"/></extAccount-collection>
                </pdomOutput></ExecuteQueryResponse>
            </SOAP-ENV:Body>
            </SOAP-ENV:Envelope>`));

            var queryDef = {
                "schema": "nms:extAccount",
                "operation": "select",
                "select": {
                    "node": [
                        { "expr": "@id" },
                        { "expr": "@name" }
                    ]
                }
            };

            var query = client.NLWS.xtkQueryDef.create(queryDef);
            var extAccount = await query.executeQuery();
            expect(extAccount).toEqual({ extAccount: [{ "id": "1" }] });
        });
    })

    describe("Representations", () => {

        it("from default representation", async () => {
            const client = await Mock.makeClient();
            var xml = DomUtil.toXMLString(client._fromRepresentation("root", {}));
            expect(xml).toBe("<root/>");
        })

        it("from SimpleJson representation", async () => {
            const client = await Mock.makeClient();
            var xml = DomUtil.toXMLString(client._fromRepresentation("root", {}, "SimpleJson"));
            expect(xml).toBe("<root/>");
        })

        describe("Convert across representations ", () => {

            it("Should convert from BadgerFish to BadgerFish", async () => {
                const client = await Mock.makeClient();
                var from = { "@id": "1", "child": {} };
                var to = client._convertToRepresentation(from, "BadgerFish", "BadgerFish");
                expect(to).toStrictEqual(from);
            })

            it("Should convert from BadgerFish to SimpleJson", async () => {
                const client = await Mock.makeClient();
                var from = { "@id": "1", "child": {} };
                var to = client._convertToRepresentation(from, "BadgerFish", "SimpleJson");
                expect(to).toStrictEqual({ id: "1", child: {} });
            })


        });

        it("Compare representations", async () => {
            const client = await Mock.makeClient();
            expect(() => { client._isSameRepresentation("json", "json") }).toThrow("SDK-000004");
            expect(() => { client._isSameRepresentation("json", "BadgerFish") }).toThrow("SDK-000004");
            expect(() => { client._isSameRepresentation("BadgerFish", "json") }).toThrow("SDK-000004");
            expect(client._isSameRepresentation("SimpleJson", "SimpleJson")).toBeTruthy();
            expect(client._isSameRepresentation("BadgerFish", "SimpleJson")).toBeFalsy();
            expect(client._isSameRepresentation("SimpleJson", "BadgerFish")).toBeFalsy();
            expect(client._isSameRepresentation("xml", "BadgerFish")).toBeFalsy();
            expect(client._isSameRepresentation("SimpleJson", "xml")).toBeFalsy();
            expect(() => { client._isSameRepresentation("Xml", "Xml") }).toThrow("SDK-000004");
            expect(() => { client._isSameRepresentation("xml", "Xml") }).toThrow("SDK-000004");
            expect(() => { client._isSameRepresentation("Xml", "xml") }).toThrow("SDK-000004");
            expect(() => { client._isSameRepresentation("", "xml") }).toThrow("SDK-000004");
            expect(() => { client._isSameRepresentation("xml", "") }).toThrow("SDK-000004");
            expect(() => { client._isSameRepresentation("xml", null) }).toThrow("SDK-000004");
        })
    });

    describe("Call which returns a single DOM document", () => {

        it("Should work with SimpleJson representation", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_GETSCHEMA_HELLO_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_HELLO_RESPONSE);
            var doc = await client.NLWS.xtkHello.world();
            expect(doc).toEqual({ world: "cruel" });
        });

        it("Should fail with Xml representation", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            // Make a successful call with "SimpleJson" first to make sure the schema
            // and method are cached. If not, getting the schema will fail when we
            // pass an incorrect representation and hence, we'll not reach the code
            // that should fail decodeing the DOM document returned by the "World" function
            client._transport.mockReturnValueOnce(Mock.GET_GETSCHEMA_HELLO_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_HELLO_RESPONSE);
            var doc = await client.NLWS.xtkHello.world();
            expect(doc).toEqual({ world: "cruel" });

            await expect(async () => {
                client._representation = "Dummy";
                client._transport.mockReturnValueOnce(Mock.GET_HELLO_RESPONSE);
                var doc = await client.NLWS.xtkHello.world();
                expect(doc).toEqual({ world: "cruel" });
            }).rejects.toMatchObject({ errorCode: "SDK-000004" });
        });
    });

    describe("Logon with session token", () => {
        // With session token logon, the session token is passed by the caller, and therefore the will be no "Logon" call

        it("Should create logged client", async() => {
            const connectionParameters = sdk.ConnectionParameters.ofSessionToken("http://acc-sdk:8080", "mc/");
            const client = await sdk.init(connectionParameters);
            client._transport = jest.fn();
            expect(client.isLogged()).toBeFalsy();
            await client.logon();
            expect(client.isLogged()).toBeTruthy();
            await client.logoff();
            expect(client.isLogged()).toBeFalsy();
        })
    })


    describe("Anonymous login", () => {
        // With anonymous login, one is always logged

        it("Should create anonymous client", async() => {
            const connectionParameters = sdk.ConnectionParameters.ofAnonymousUser("http://acc-sdk:8080");
            const client = await sdk.init(connectionParameters);
            client._transport = jest.fn();
            expect(client.isLogged()).toBeTruthy();
            await client.logon();
            expect(client.isLogged()).toBeTruthy();
            await client.logoff();
            expect(client.isLogged()).toBeTruthy();
        })
    })

    it("User agent string", async () => {
        const client = await Mock.makeClient();
        const ua = client._getUserAgentString();
        expect(ua.startsWith("@adobe/acc-js-sdk/")).toBeTruthy();
        expect(ua.endsWith(" ACC Javascript SDK")).toBeTruthy();
    })


    describe("PushEvent API", () => {
        it("Should generate the corect document root", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_NMS_RTEVENT_SCHEMA_RESPONSE);
            client._transport.mockImplementationOnce(options => {
                const doc = DomUtil.parse(options.data);
                const body = DomUtil.findElement(doc.documentElement, "SOAP-ENV:Body");
                const method = DomUtil.getFirstChildElement(body);
                const event = DomUtil.findElement(method, "event");
                const rtEvent = DomUtil.findElement(event, "rtEvent");
                if (!rtEvent)
                    throw new Error("Did not find 'rtEvent' node");
                if (rtEvent.getAttribute("type") != "welcome")
                    throw new Error("Did not find 'type' attribute with 'welcome' value");

                return Promise.resolve(`<?xml version='1.0'?>
                        <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:nms:rtEvent' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
                        <SOAP-ENV:Body>
                        <PushEventResponse xmlns='urn:nms:rtEvent' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                        <plId xsi:type='xsd:long'>72057594039155998</plId>
                        </PushEventResponse>
                        </SOAP-ENV:Body>
                        </SOAP-ENV:Envelope>`);
            });
            await client.NLWS.nmsRtEvent.pushEvent({
                wishedChannel: 0,
                type: "welcome",
                email: "aggmorin@gmail.com",
                ctx: {
                  $firstName: "Alex"
                }
              });

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });
    });

    describe("/r/test API", () => {
        it("Should call test API", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.R_TEST);
            const test = await client.test();
            expect(test.build).toBe("9236");
            expect(test.date).toBe("2021-08-27 08:02:07.963-07");
            expect(test.host).toBe("xxxol.campaign.adobe.com");
            expect(test.instance).toBe("xxx_mkt_prod1");
            expect(test.localHost).toBe("xxxol-mkt-prod1-1");
            expect(test.sha1).toBe("cc45440");
            expect(test.sourceIP).toBe("193.104.215.11");
            expect(test.status).toBe("OK");

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });

        it("Should fail to call test API", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockRejectedValueOnce(new HttpError(504, "This call failed"));
            await expect(client.test()).rejects.toMatchObject({ statusCode:504, message:"504 - Error calling method '/r/test': This call failed" });
        });
    })

    describe("/nl/jsp/ping.jsp API", () => {
        it("Should call ping API", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.PING);
            const ping = await client.ping();
            expect(ping.status).toBe("OK");
            expect(ping.timestamp).toBe("2021-08-27 15:43:48.862Z");

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });

        it("Truncated result from ping API", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Promise.resolve("OK"));
            var ping = await client.ping();
            expect(ping.status).toBe("OK");
            expect(ping.timestamp).toBeUndefined();


            client._transport.mockReturnValueOnce(Promise.resolve("OK\n"));
            ping = await client.ping();
            expect(ping.status).toBe("OK");
            expect(ping.timestamp).toBeUndefined();

            client._transport.mockReturnValueOnce( Promise.resolve(""));
            ping = await client.ping();
            expect(ping.status).toBeUndefined();
            expect(ping.timestamp).toBeUndefined();

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });

        it("Should fail to call ping API", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockRejectedValueOnce(new HttpError(504, "This call failed"));
            await expect(client.ping()).rejects.toMatchObject({ statusCode:504, message:"504 - Error calling method '/nl/jsp/ping.jsp': This call failed" });
        });

    });

    describe("/nl/jsp/mcPing.jsp API", () => {
        it("Should call mcPing API", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.MC_PING);
            const ping = await client.mcPing();
            expect(ping.status).toBe("Ok");
            expect(ping.timestamp).toBe("2021-08-27 15:48:07.893Z");
            expect(ping.eventQueueSize).toBe("7");
            expect(ping.eventQueueMaxSize).toBe("400");

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });

        it("Should return an error", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.MC_PING_ERROR);
            const ping = await client.mcPing();
            expect(ping.status).toBe("Error");
            expect(ping.timestamp).toBeUndefined();
            expect(ping.eventQueueSize).toBe("7");
            expect(ping.eventQueueMaxSize).toBe("400");

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });

        it("Should fail to call MC ping API", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockRejectedValueOnce(new HttpError(504, "This call failed"));
            await expect(client.mcPing()).rejects.toMatchObject({ statusCode:504, message:"504 - Error calling method '/nl/jsp/mcPing.jsp': This call failed" });
        });


        it("Truncated result from mcping API", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Promise.resolve("OK"));
            var ping = await client.mcPing();
            expect(ping.status).toBe("OK");
            expect(ping.timestamp).toBeUndefined();
            expect(ping.eventQueueSize).toBeUndefined();
            expect(ping.eventQueueMaxSize).toBeUndefined();

            client._transport.mockReturnValueOnce(Promise.resolve("OK\n"));
            ping = await client.mcPing();
            expect(ping.status).toBe("OK");
            expect(ping.timestamp).toBeUndefined();
            expect(ping.eventQueueSize).toBeUndefined();
            expect(ping.eventQueueMaxSize).toBeUndefined();

            client._transport.mockReturnValueOnce(Promise.resolve("OK\n\n"));
            ping = await client.mcPing();
            expect(ping.status).toBe("OK");
            expect(ping.timestamp).toBeUndefined();
            expect(ping.eventQueueSize).toBeUndefined();
            expect(ping.eventQueueMaxSize).toBeUndefined();

            client._transport.mockReturnValueOnce(Promise.resolve("OK\n\n7/"));
            ping = await client.mcPing();
            expect(ping.status).toBe("OK");
            expect(ping.timestamp).toBeUndefined();
            expect(ping.eventQueueSize).toBeUndefined();
            expect(ping.eventQueueMaxSize).toBeUndefined();

            client._transport.mockReturnValueOnce( Promise.resolve(""));
            ping = await client.mcPing();
            expect(ping.status).toBeUndefined();
            expect(ping.timestamp).toBeUndefined();
            expect(ping.eventQueueSize).toBeUndefined();
            expect(ping.eventQueueMaxSize).toBeUndefined();

            client._transport.mockReturnValueOnce( Promise.resolve("Error"));
            ping = await client.mcPing();
            expect(ping.status).toBe("Error");
            expect(ping.timestamp).toBeUndefined();
            expect(ping.eventQueueSize).toBeUndefined();
            expect(ping.eventQueueMaxSize).toBeUndefined();

            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.NLWS.xtkSession.logoff();
        });
    });

    describe("Observers", () => {

        it("Should observe SOAP api Call (getOption)", async () => {
            const client = await Mock.makeClient();
            const expected = [
                "xtk:session#Logon", true,
                "xtk:persist#GetEntityIfMoreRecent", true,
                "xtk:session#GetOption", true,
            ];
            const observed = [];

            client.registerObserver({
                onSOAPCall: (soapCall) => {
                    const request = soapCall.request;
                    const soapAction = request.headers["SoapAction"];
                    observed.push(soapAction);
                },
                onSOAPCallSuccess: () => {
                    observed.push(true);
                }
            });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_DATABASEID_RESPONSE);
            var databaseId = await client.getOption("XtkDatabaseId");
            expect(databaseId).toBe("uFE80000000000000F1FA913DD7CC7C480041161C");

            expect(observed).toStrictEqual(expected);
        });

        it("Should observe SOAP call failure", async () => {
            const client = await Mock.makeClient();

            var observedException = undefined;
            client.registerObserver({
                onSOAPCallFailure: (soapCall, exception) => {
                    observedException = exception;
                }
            });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0' encoding='UTF-8'?>
                        <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/' xmlns:ns='http://xml.apache.org/xml-soap'>
                            <SOAP-ENV:Body>
                                <SOAP-ENV:Fault>
                                <faultcode>faultcode</faultcode>
                                <faultstring>XXX-000000</faultstring>
                                <detail>detail</detail>
                                </SOAP-ENV:Fault>
                            </SOAP-ENV:Body>
                        </SOAP-ENV:Envelope>`));
            await expect(client.getOption("XtkDatabaseId")).rejects.toMatchObject({ errorCode: "XXX-000000" });
            expect(observedException).toMatchObject({ errorCode: "XXX-000000" });

        });

        it("Should ignore unregistering non-existant observers", async () => {
            const client = await Mock.makeClient();
            client.registerObserver({ onSOAPCall: () => {} });
            expect(client._observers.length).toBe(1);
            client.unregisterObserver({ onSOAPCall: () => {} });
            expect(client._observers.length).toBe(1);
        });

        it("Should unregister observer", async () => {
            const client = await Mock.makeClient();
            var countCalls = 0;
            var countSuccesses = 0;

            const observer1 = {
                onSOAPCall: () => { countCalls = countCalls + 1; },
                onSOAPCallSuccess: () => { countSuccesses = countSuccesses + 1; }
            };
            const observer2 = {
                onSOAPCallSuccess: () => { countSuccesses = countSuccesses + 1; }
            };
            client.registerObserver(observer1);
            client.registerObserver(observer2);
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            expect(countCalls).toBe(1);
            expect(countSuccesses).toBe(2);

            client.unregisterObserver(observer1);
            expect(client._observers.length).toBe(1);

            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_DATABASEID_RESPONSE);
            await client.getOption("XtkDatabaseId");
            expect(countCalls).toBe(1);
            expect(countSuccesses).toBe(4);
        });

        it("Should unregister all observers", async () => {
            const client = await Mock.makeClient();
            var countCalls = 0;
            var countSuccesses = 0;

            const observer1 = {
                onSOAPCall: () => { countCalls = countCalls + 1; },
                onSOAPCallSuccess: () => { countSuccesses = countSuccesses + 1; }
            };
            const observer2 = {
                onSOAPCallSuccess: () => { countSuccesses = countSuccesses + 1; }
            };
            client.registerObserver(observer1);
            client.registerObserver(observer2);
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            expect(countCalls).toBe(1);
            expect(countSuccesses).toBe(2);

            client.unregisterAllObservers();
            expect(client._observers.length).toBe(0);

            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_DATABASEID_RESPONSE);
            await client.getOption("XtkDatabaseId");
            expect(countCalls).toBe(1);
            expect(countSuccesses).toBe(2);
        });

        it("Should observe internal SOAP calls", async () => {
            const client = await Mock.makeClient();
            const expected = [
                "xtk:session#Logon", false,
                // This call is internal (issued by the framework, not by the called)
                "xtk:persist#GetEntityIfMoreRecent", true,
                "xtk:session#GetOption", false,
            ];
            const observed = [];

            client.registerObserver({
                onSOAPCall: (soapCall) => {
                    const request = soapCall.request;
                    const soapAction = request.headers["SoapAction"];
                    observed.push(soapAction);
                    observed.push(soapCall.internal);
                },
            });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_DATABASEID_RESPONSE);
            await client.getOption("XtkDatabaseId");
            expect(observed).toStrictEqual(expected);
        });
    })

    describe("Tracing Http calls", () => {
        it('Should trace HTTP successful call', async () => {
            const logs = await Mock.withMockConsole(async () => {
                const client = await Mock.makeClient();
                client.traceAPICalls(true);
                client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
                await client.NLWS.xtkSession.logon();

                client._transport.mockReturnValueOnce(Mock.PING);
                const ping = await client.ping();
                expect(ping.status).toBe("OK");
                expect(ping.timestamp).toBe("2021-08-27 15:43:48.862Z");
            })
            expect(logs.length).toBe(4);
            expect(logs[0]).toMatch(/SOAP.*request.*Logon/is)
            expect(logs[1]).toMatch(/SOAP.*response.*LogonResponse/is)
            expect(logs[2]).toMatch(/HTTP.*request.*nl.jsp.ping.jsp/is)
            expect(logs[3]).toMatch(/HTTP.*response.*OK/is)
        });

        it("Should trace HTTP call with no data and no answer", async () => {
            const logs = await Mock.withMockConsole(async () => {
                const client = await Mock.makeClient();
                client.traceAPICalls(true);
                client._transport.mockReturnValueOnce(Promise.resolve());
                await client._makeHttpCall({ method:"GET", url:"http://test.com" });
            });
            expect(logs.length).toBe(2);
            expect(logs[0]).toMatch(/HTTP.*request.*GET.*test.com/is)
            expect(logs[1]).toMatch(/HTTP.*response/is)
        })

        it("Should trace HTTP call with data and no answer", async () => {
            const logs = await Mock.withMockConsole(async () => {
                const client = await Mock.makeClient();
                client.traceAPICalls(true);
                client._transport.mockReturnValueOnce(Promise.resolve());
                await client._makeHttpCall({ method:"GET", url:"http://test.com", data:"Hello" });
            });
            expect(logs.length).toBe(2);
            expect(logs[0]).toMatch(/HTTP.*request.*GET.*test.com.*Hello/is)
            expect(logs[1]).toMatch(/HTTP.*response/is)
        })

        it('Should trace HTTP failed call', async () => {
            const logs = await Mock.withMockConsole(async () => {
                const client = await Mock.makeClient();
                client.traceAPICalls(true);
                client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
                await client.NLWS.xtkSession.logon();

                client._transport.mockRejectedValueOnce(new HttpError(504, "This call failed"));
                await expect(client.ping()).rejects.toMatchObject({ statusCode:504, message:"504 - Error calling method '/nl/jsp/ping.jsp': This call failed" });
            });
            expect(logs.length).toBe(4);
            expect(logs[0]).toMatch(/SOAP.*request.*Logon/is)
            expect(logs[1]).toMatch(/SOAP.*response.*LogonResponse/is)
            expect(logs[2]).toMatch(/HTTP.*request.*nl.jsp.ping.jsp/is)
            expect(logs[3]).toMatch(/HTTP.*failure/is)
        });
    })

    describe("Observing Http calls", () => {
        it('Should observe HTTP successful call', async () => {

            const observer = {
                onHTTPCall: jest.fn(),
                onHTTPCallSuccess: jest.fn()
            };

            const client = await Mock.makeClient();
            client.registerObserver(observer);
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.PING);
            await client.ping();

            expect(observer.onHTTPCall.mock.calls.length).toBe(1);
            expect(observer.onHTTPCall.mock.calls[0].length).toBe(2);    // 2 arguments
            expect(observer.onHTTPCall.mock.calls[0][0]).toMatchObject({
                headers: { },
                method: "GET",
                url: "http://acc-sdk:8080/nl/jsp/ping.jsp"
            });
            expect(observer.onHTTPCall.mock.calls[0][1]).toBeUndefined();

            expect(observer.onHTTPCallSuccess.mock.calls.length).toBe(1);
            expect(observer.onHTTPCallSuccess.mock.calls[0].length).toBe(2);    // 2 arguments
            expect(observer.onHTTPCallSuccess.mock.calls[0][0]).toMatchObject({
                headers: { },
                method: "GET",
                url: "http://acc-sdk:8080/nl/jsp/ping.jsp"
            });
            expect(observer.onHTTPCallSuccess.mock.calls[0][1]).toMatch("OK");
        });

        it('Should observe HTTP failed call', async () => {
            const observer = {
                onHTTPCallFailure: jest.fn()
            };

            const client = await Mock.makeClient();
            client.registerObserver(observer);
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockRejectedValueOnce(new HttpError(504, "This call failed"));
            await expect(client.ping()).rejects.toMatchObject({ statusCode:504, message:"504 - Error calling method '/nl/jsp/ping.jsp': This call failed" });

            expect(observer.onHTTPCallFailure.mock.calls.length).toBe(1);
            expect(observer.onHTTPCallFailure.mock.calls[0].length).toBe(2);    // 2 arguments
            expect(observer.onHTTPCallFailure.mock.calls[0][0]).toMatchObject({
                headers: { },
                method: "GET",
                url: "http://acc-sdk:8080/nl/jsp/ping.jsp"
            });
            expect(observer.onHTTPCallFailure.mock.calls[0][1]).toMatchObject({ statusCode:504, statusText: "This call failed" });
        });
    });

    it('Should support empty observers', async () => {
        const observer = { };   // none of the functions are implemented

        const client = await Mock.makeClient();
        client.registerObserver(observer);
        client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
        await client.NLWS.xtkSession.logon();

        client._transport.mockReturnValueOnce(Mock.PING);
        await client.ping();

        expect(true).toBe(true);    // should reach here without failures
    });

    describe("HTTP call defaults", () => {
        it("Should default to GET method", async () => {
            const client = await Mock.makeClient();
            const observer = { onHTTPCall: jest.fn() };
            client.registerObserver(observer);
            client._transport.mockReturnValueOnce(Promise.resolve());
            await client._makeHttpCall({ url:"http://test.com"  });
            const request = observer.onHTTPCall.mock.calls[0][0];
            expect(request).toMatchObject({ method: "GET" });
        })


        it("Default to GET method should not override method", async () => {
            const client = await Mock.makeClient();
            const observer = { onHTTPCall: jest.fn() };
            client.registerObserver(observer);
            client._transport.mockReturnValueOnce(Promise.resolve());
            await client._makeHttpCall({ method: "POST", url:"http://test.com"  });
            const request = observer.onHTTPCall.mock.calls[0][0];
            expect(request).toMatchObject({ method: "POST" });
        })

        it("Should default to user agent header", async () => {
            const client = await Mock.makeClient();
            const observer = { onHTTPCall: jest.fn() };
            client.registerObserver(observer);
            client._transport.mockReturnValueOnce(Promise.resolve());
            await client._makeHttpCall({ url:"http://test.com"  });
            const request = observer.onHTTPCall.mock.calls[0][0];
            expect(request.headers['User-Agent']).toMatch('@adobe/acc-js-sdk');
        })

        it("Should support overwriting the user agent header", async () => {
            const client = await Mock.makeClient();
            const observer = { onHTTPCall: jest.fn() };
            client.registerObserver(observer);
            client._transport.mockReturnValueOnce(Promise.resolve());
            await client._makeHttpCall({ url:"http://test.com", headers:{'User-Agent': "My user agent"}  });
            const request = observer.onHTTPCall.mock.calls[0][0];
            expect(request).toMatchObject({ headers: { 'User-Agent': "My user agent" } });
        })
    });

    describe("Override transport", () => {
        it("Should override transport" , async() => {
            const client = await Mock.makeClient();
            const transport = jest.fn();
            client.setTransport(transport);
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            const calls = transport.mock.calls;
            expect(calls.length).toBe(1);
            expect(calls[0][0].data).toMatch("Logon");
        });
    })

    describe("Security token authentication", () => {
        // Security token authentication is used when embedding the SDK in Campaign: the session token
        // is provided by the browser as a cookie. The cookie is not readable by JavaScript code and
        // should be passed automatically by the browser, not by the SDK
        it("Should create logged client", async() => {
            const connectionParameters = sdk.ConnectionParameters.ofSecurityToken("http://acc-sdk:8080", "$security_token$");
            const client = await sdk.init(connectionParameters);
            client._transport = jest.fn();
            expect(client.isLogged()).toBeFalsy();
            await client.logon();
            expect(client.isLogged()).toBeTruthy();
            const logoff = client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.logoff();
            expect(client.isLogged()).toBeFalsy();
            // Ensure logoff has been called
            expect(logoff.mock.calls.length).toBe(1);
        })
     })

    describe("Bearer token authentication", () => {
        // Bearer token authentication is used when embedding IMS for authentication
        it("Should create logged client", async() => {
            const connectionParameters = sdk.ConnectionParameters.ofBearerToken("http://acc-sdk:8080");
            const client = await sdk.init(connectionParameters);
            client._transport = jest.fn();
            client._transport.mockReturnValueOnce(Mock.BEARER_LOGON_RESPONSE);
            expect(client.isLogged()).toBeFalsy();
            await client.logon();
            expect(client.isLogged()).toBeTruthy();
            const transport = client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.logoff();
            expect(client.isLogged()).toBeFalsy();
            // Ensure logoff has been called
            expect(transport.mock.calls.length).toBe(2);
        })

        it("Call SAOP method", async () => {
            const connectionParameters = sdk.ConnectionParameters.ofBearerToken("http://acc-sdk:8080", "$token$");
            const client = await sdk.init(connectionParameters);
            client._transport = jest.fn();
            client._transport.mockReturnValueOnce(Mock.BEARER_LOGON_RESPONSE);
            await client.logon();
            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            var queryDef = {
                "schema": "nms:extAccount",
                "operation": "select",
                "select": {
                    "node": [
                        { "expr": "@id" },
                        { "expr": "@name" }
                    ]
                }
            };

            client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0'?>
            <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:xtk:queryDef' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
            <SOAP-ENV:Body>
            <ExecuteQueryResponse xmlns='urn:xtk:queryDef' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                <pdomOutput xsi:type='ns:Element' SOAP-ENV:encodingStyle='http://xml.apache.org/xml-soap/literalxml'>
                <extAccount-collection/>
                </pdomOutput></ExecuteQueryResponse>
            </SOAP-ENV:Body>
            </SOAP-ENV:Envelope>`));

            // Select should return empty array
            var query = client.NLWS.xtkQueryDef.create(queryDef);
            var extAccount = await query.executeQuery();
            expect(extAccount).toEqual({ extAccount: [] });
        });

        it("Expired session refresh client callback", async () => {
            let refreshClient = async () => {
                const connectionParameters = sdk.ConnectionParameters.ofSecurityToken("http://acc-sdk:8080",
                                                        "$security_token$", {refreshClient: refreshClient});
                const newClient = await sdk.init(connectionParameters);
                newClient._transport = jest.fn();
                newClient._transport.mockReturnValueOnce(Mock.BEARER_LOGON_RESPONSE);
                await newClient.logon();
                return newClient;
            }
            const connectionParameters = sdk.ConnectionParameters.ofBearerToken("http://acc-sdk:8080",
                                                    "$token$", {refreshClient: refreshClient});
            const client = await sdk.init(connectionParameters);
            client.traceAPICalls(true);
            client._transport = jest.fn();
            client._transport.mockReturnValueOnce(Mock.BEARER_LOGON_RESPONSE);
            client._transport.mockReturnValueOnce(Promise.resolve(`XSV-350008 Session has expired or is invalid. Please reconnect.`));
            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0'?>
                <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:xtk:queryDef' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
                <SOAP-ENV:Body>
                <ExecuteQueryResponse xmlns='urn:xtk:queryDef' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                    <pdomOutput xsi:type='ns:Element' SOAP-ENV:encodingStyle='http://xml.apache.org/xml-soap/literalxml'>
                    <extAccount-collection/>
                    </pdomOutput></ExecuteQueryResponse>
                </SOAP-ENV:Body>
                </SOAP-ENV:Envelope>`));
            await client.logon();
            var queryDef = {
                "schema": "nms:extAccount",
                "operation": "select",
                "select": {
                    "node": [
                        { "expr": "@id" },
                        { "expr": "@name" }
                    ]
                }
            };
            var query = client.NLWS.xtkQueryDef.create(queryDef);
            var extAccount = await query.executeQuery();
            expect(extAccount).toEqual({ extAccount: [] });
            // Same test as before traceAPICalls = false for code coverage
            client._transport.mockReturnValueOnce(Promise.resolve(`XSV-350008 Session has expired or is invalid. Please reconnect.`));
            client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0'?>
                <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:xtk:queryDef' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
                <SOAP-ENV:Body>
                <ExecuteQueryResponse xmlns='urn:xtk:queryDef' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                    <pdomOutput xsi:type='ns:Element' SOAP-ENV:encodingStyle='http://xml.apache.org/xml-soap/literalxml'>
                    <extAccount-collection/>
                    </pdomOutput></ExecuteQueryResponse>
                </SOAP-ENV:Body>
                </SOAP-ENV:Envelope>`));
            client.traceAPICalls(false);
            var query1  = client.NLWS.xtkQueryDef.create(queryDef);
            const extAccount1 = await query1.executeQuery();
            expect(extAccount1).toEqual({ extAccount: [] });
        });

        it("Expired session refresh client callback for code coverage", async () => {
            let refreshClient = async () => {
                const connectionParameters = sdk.ConnectionParameters.ofSessionToken("http://acc-sdk:8080", "$session_token$");
                const newClient = await sdk.init(connectionParameters);
                newClient._transport = jest.fn();
                newClient._transport.mockReturnValueOnce(Mock.BEARER_LOGON_RESPONSE);
                await newClient.logon();
                return newClient;
            }
            const connectionParameters = sdk.ConnectionParameters.ofBearerToken("http://acc-sdk:8080",
                                                    "$token$", {refreshClient: refreshClient});
            const client = await sdk.init(connectionParameters);
            client.traceAPICalls(true);
            client._transport = jest.fn();
            client._transport.mockReturnValueOnce(Mock.BEARER_LOGON_RESPONSE);
            client._transport.mockReturnValueOnce(Promise.resolve(`XSV-350008 Session has expired or is invalid. Please reconnect.`));
            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0'?>
                <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:xtk:queryDef' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
                <SOAP-ENV:Body>
                <ExecuteQueryResponse xmlns='urn:xtk:queryDef' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                    <pdomOutput xsi:type='ns:Element' SOAP-ENV:encodingStyle='http://xml.apache.org/xml-soap/literalxml'>
                    <extAccount-collection/>
                    </pdomOutput></ExecuteQueryResponse>
                </SOAP-ENV:Body>
                </SOAP-ENV:Envelope>`));
            await client.logon();
            var queryDef = {
                "schema": "nms:extAccount",
                "operation": "select",
                "select": {
                    "node": [
                        { "expr": "@id" },
                        { "expr": "@name" }
                    ]
                }
            };
            var query = client.NLWS.xtkQueryDef.create(queryDef);
            var extAccount = await query.executeQuery();
            expect(extAccount).toEqual({ extAccount: [] });
        });

        it("Expired session refresh client callback retry failure", async () => {
            let refreshClient = async () => {
                const connectionParameters = sdk.ConnectionParameters.ofBearerToken("http://acc-sdk:8080",
                "$token$", {refreshClient: refreshClient});
                const newClient = await sdk.init(connectionParameters);
                newClient._transport = jest.fn();
                newClient._transport.mockReturnValueOnce(Mock.BEARER_LOGON_RESPONSE);
                await newClient.logon();
                return newClient;
            }
            const connectionParameters = sdk.ConnectionParameters.ofSecurityToken("http://acc-sdk:8080",
                                                    "$security_token$", {refreshClient: refreshClient});
            const client = await sdk.init(connectionParameters);
            client._transport = jest.fn();
            client._transport.mockReturnValueOnce(Promise.resolve(`XSV-350008 Session has expired or is invalid. Please reconnect.`));
            client._transport.mockReturnValueOnce(Promise.resolve(`XSV-350008 Session has expired or is invalid. Please reconnect.`));
            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0'?>
                <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:xtk:queryDef' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
                <SOAP-ENV:Body>
                <ExecuteQueryResponse xmlns='urn:xtk:queryDef' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                    <pdomOutput xsi:type='ns:Element' SOAP-ENV:encodingStyle='http://xml.apache.org/xml-soap/literalxml'>
                    <extAccount-collection/>
                    </pdomOutput></ExecuteQueryResponse>
                </SOAP-ENV:Body>
                </SOAP-ENV:Envelope>`));
            await client.logon();
            var queryDef = {
                "schema": "nms:extAccount",
                "operation": "select",
                "select": {
                    "node": [
                        { "expr": "@id" },
                        { "expr": "@name" }
                    ]
                }
            };
            var query = client.NLWS.xtkQueryDef.create(queryDef);
            await expect(query.executeQuery()).rejects.toMatchObject({ errorCode: "SDK-000012" });
            expect(client._transport.mock.calls.length).toBe(2);
         });
    })

    describe("Logon should always return a promise", () => {

        it("Should return a promise with UserPassword", async () => {
            const connectionParameters = sdk.ConnectionParameters.ofUserAndPassword("http://acc-sdk:8080", "$user$", "$password$");
            const client = await sdk.init(connectionParameters);
            client._transport = jest.fn();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            const result = client.logon();
            expect(result instanceof Promise).toBe(true);
            await result;
        })

        it("Should return a promise with bearer token", async () => {
            const connectionParameters = sdk.ConnectionParameters.ofBearerToken("http://acc-sdk:8080", "$token$");
            const client = await sdk.init(connectionParameters);
            client._transport = jest.fn();
            client._transport.mockReturnValueOnce(Mock.BEARER_LOGON_RESPONSE);
            const result = client.logon();
            expect(result instanceof Promise).toBe(true);
            await result;
        })

        it("Should return a promise with UserAndServiceToken", async () => {
            const connectionParameters = sdk.ConnectionParameters.ofUserAndServiceToken("http://acc-sdk:8080", "$user$", "$service_token$");
            const client = await sdk.init(connectionParameters);
            client._transport = jest.fn();
            const result = client.logon();
            expect(result instanceof Promise).toBe(true);
            try {
                await result;
            } catch(ex) { /* result or exception is not handled */ }
        })

        it("Should return a promise with SessionToken", async () => {
            const connectionParameters = sdk.ConnectionParameters.ofSessionToken("http://acc-sdk:8080", "$session_token$");
            const client = await sdk.init(connectionParameters);
            client._transport = jest.fn();
            const result = client.logon();
            expect(result instanceof Promise).toBe(true);
            await result;
        })

        it("Should return a promise with SecurityToken", async () => {
            const connectionParameters = sdk.ConnectionParameters.ofSecurityToken("http://acc-sdk:8080", "$security_token$");
            const client = await sdk.init(connectionParameters);
            client._transport = jest.fn();
            const result = client.logon();
            expect(result instanceof Promise).toBe(true);
            await result;
        })

        it("Should return a promise with AnonymousUser", async () => {
            const connectionParameters = sdk.ConnectionParameters.ofAnonymousUser("http://acc-sdk:8080");
            const client = await sdk.init(connectionParameters);
            client._transport = jest.fn();
            const result = client.logon();
            expect(result instanceof Promise).toBe(true);
            await result;
        })
    })


    describe("Should simulate server down", () => {
        it("Should simulate server down and up again", async () => {
            // Server is up and getOption
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_DATABASEID_RESPONSE);
            var databaseId = await client.getOption("XtkDatabaseId", false);
            expect(databaseId).toBe("uFE80000000000000F1FA913DD7CC7C480041161C");

            // Now simulate a connection error (server is down)
            const error = new Error("connect ECONNREFUSED 3.225.73.178:8080");
            error.code="ECONNREFUSED";
            error.errno="ECONNREFUSED";
            client._transport.mockReturnValueOnce(Promise.reject(error));
            await expect(client.getOption("XtkDatabaseId", false)).rejects.toMatchObject({
                message: "500 - Error calling method 'xtk:session#GetOption': Error (connect ECONNREFUSED 3.225.73.178:8080)"
            });

            // Server is back up again
            client._transport.mockReturnValueOnce(Mock.GET_DATABASEID_RESPONSE);
            databaseId = await client.getOption("XtkDatabaseId", false);
            expect(databaseId).toBe("uFE80000000000000F1FA913DD7CC7C480041161C")
        });
    })

    describe("Connection options", () => {
        it("Should set options cache TTL", async () => {
           const client = await Mock.makeClient({ optionCacheTTL: -1 });
           client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
           client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
           await client.NLWS.xtkSession.logon();
           // Get Option and cache result. Check the value is in cache
           client._transport.mockReturnValueOnce(Mock.GET_DATABASEID_RESPONSE);
           await client.getOption("XtkDatabaseId", true);
           expect(client._optionCache._cache["XtkDatabaseId"].value).toMatchObject({ type: 6, rawValue: "uFE80000000000000F1FA913DD7CC7C480041161C" });
           // Get it again, it should not use the cache (=> it should make a SOAP call)
           // To test if the SOAP call is made, we mock the SOAP call answer with a different result
           client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0'?>
                    <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:xtk:session' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
                    <SOAP-ENV:Body>
                        <GetOptionResponse xmlns='urn:xtk:session' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                            <pstrValue xsi:type='xsd:string'>uFE80000000000000F1FA913DD7CC7C48004116FF</pstrValue>
                            <pbtType xsi:type='xsd:byte'>6</pbtType>
                        </GetOptionResponse>
                    </SOAP-ENV:Body>
                    </SOAP-ENV:Envelope>`));
            await client.getOption("XtkDatabaseId", true);
            expect(client._optionCache._cache["XtkDatabaseId"].value).toMatchObject({ type: 6, rawValue: "uFE80000000000000F1FA913DD7CC7C48004116FF" });
        })

        it("Should set default value for traceAPICalls", async () => {
            var client = await Mock.makeClient({ traceAPICalls: undefined });
            expect(client._traceAPICalls).toBeFalsy();
            client = await Mock.makeClient({ traceAPICalls: null });
            expect(client._traceAPICalls).toBeFalsy();
            client = await Mock.makeClient({ traceAPICalls: false });
            expect(client._traceAPICalls).toBeFalsy();
            client = await Mock.makeClient({ traceAPICalls: true });
            expect(client._traceAPICalls).toBeTruthy();
        })

        it("Should set default transport", async () => {
            var client = await Mock.makeClient({ transport: async () => {
                return "Hello";
            }});
            await expect(client._transport()).resolves.toBe("Hello");
        });
    })


    describe("Local storage", () => {
        it("Shoud read from local storage", async () => {
            const storage = {
                getItem: jest.fn(),
                setItem: jest.fn(),
            }
            const client = await Mock.makeClient({ storage: storage });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GETMODIFIEDENTITIES_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GETMODIFIEDENTITIES_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            await client.NLWS.xtkSession.logon();
            storage.getItem.mockReturnValueOnce(JSON.stringify({value: { value: "Hello", type: 6 }, cachedAt: 1633715996021 }));
            const value = await client.getOption("XtkDatabaseId");
            expect(value).toBe("Hello");
        })

        it("Should write to local storage", async () => {
            const storage = {
                getItem: jest.fn(),
                setItem: jest.fn(),
            }
            const client = await Mock.makeClient({ storage: storage });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            await client.NLWS.xtkSession.logon();
            storage.getItem.mockReturnValueOnce(JSON.stringify({value: { value: "Hello", type: 6 }, cachedAt: 1633715996021 }));
            client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0'?>
                            <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:wpp:default' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
                            <SOAP-ENV:Body>
                            <WriteResponse xmlns='urn:wpp:default' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                            </WriteResponse>
                            </SOAP-ENV:Body>
                            </SOAP-ENV:Envelope>`));
            await client.setOption("XtkDatabaseId", "World");
            var call = undefined;
            for (var i=0; i<storage.setItem.mock.calls.length; i++) {
                if (storage.setItem.mock.calls[i][0].endsWith("OptionCache$XtkDatabaseId")) {
                    call = storage.setItem.mock.calls[i];
                    break;
                }
            }
            expect(JSON.parse(call[1])).toMatchObject({
                value: { value: "World", type: 6 }
            })
        });

        it("Should ignore protocol for local storage root key", async () => {
            const version = sdk.getSDKVersion().version; // "${version}" or similar

            var connectionParameters = sdk.ConnectionParameters.ofUserAndPassword("http://acc-sdk:8080", "admin", "admin", {});
            var client = await sdk.init(connectionParameters);
            expect(client._optionCache._storage._rootKey).toBe(`acc.js.sdk.${version}.acc-sdk:8080.cache.OptionCache$`);

            connectionParameters = sdk.ConnectionParameters.ofUserAndPassword("https://acc-sdk:8080", "admin", "admin", {});
            client = await sdk.init(connectionParameters);
            expect(client._optionCache._storage._rootKey).toBe(`acc.js.sdk.${version}.acc-sdk:8080.cache.OptionCache$`);

            connectionParameters = sdk.ConnectionParameters.ofUserAndPassword("acc-sdk:8080", "admin", "admin", {});
            client = await sdk.init(connectionParameters);
            expect(client._optionCache._storage._rootKey).toBe(`acc.js.sdk.${version}.acc-sdk:8080.cache.OptionCache$`);
        })

        it("Should support no storage", async () => {
            const storage = {
                getItem: jest.fn(),
                setItem: jest.fn(),
            }
            const client = await Mock.makeClient({ storage: storage, noStorage: true });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_DATABASEID_RESPONSE);
            const value = await client.getOption("XtkDatabaseId");
            expect(value).toBe('uFE80000000000000F1FA913DD7CC7C480041161C');
            expect(storage.getItem.mock.calls.length).toBe(0); // storage is disabled and should not have been called
        })

        it("Should cache XML in storage", async () => {
            const map = {};
            const storage = {
                getItem: jest.fn((key) => map[key]),
                setItem: jest.fn((key, value) => map[key] = value)
            }
            let client = await Mock.makeClient({ storage: storage });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_NMS_EXTACCOUNT_SCHEMA_RESPONSE);
             await client.getSchema("nms:extAccount");
            // Schema should have been cached to local storage
            expect(storage.setItem.mock.calls.length).toBe(1);
            expect(storage.setItem.mock.calls[0][0]).toMatch("cache.XtkEntityCache$xtk:schema|nms:extAccount");
            // Value is the cached object, it should not be an empty object
            const cached = JSON.parse(storage.setItem.mock.calls[0][1]);
            expect(Object.keys(cached.value).length).toBeGreaterThan(0);
            expect(cached.value).toMatch("<schema");

            // Now simulate reusing the local storage. We need a new client to make sure we do not reuse
            // the in-memory cache of the client.
            client = await Mock.makeClient({ storage: storage });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_NMS_EXTACCOUNT_SCHEMA_RESPONSE);
            await client.getSchema("nms:extAccount");
        })
    })

    describe("Get Schema, cache and representations", () => {
        it("Should get schema with no cache", async () => {
            const client = await Mock.makeClient();
            client.clearAllCaches();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_NMS_EXTACCOUNT_SCHEMA_RESPONSE);
            var schema = await client.getSchema("nms:extAccount");
            expect(schema["namespace"]).toBe("nms");
            expect(schema["name"]).toBe("extAccount");
        });

        it("Should get schema from the cache", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_NMS_EXTACCOUNT_SCHEMA_RESPONSE);
            var schema = await client.getSchema("nms:extAccount");
            expect(schema["namespace"]).toBe("nms");
            expect(schema["name"]).toBe("extAccount");

            client._transport.mockReturnValue(Promise.resolve(Mock.GETMODIFIEDENTITIES_RESPONSE));

            jest.useFakeTimers();
            client.startRefreshCaches(5000); // autorefresh every 5000 ms
            jest.advanceTimersByTime(6000);
            jest.useRealTimers();

            schema = await client.getSchema("nms:extAccount");
            expect(schema["namespace"]).toBe("nms");
            expect(schema["name"]).toBe("extAccount");

            client.stopRefreshCaches();
        });

        it("Should get schema from server when removed from cache", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Mock.GET_NMS_EXTACCOUNT_SCHEMA_RESPONSE);
            var schema = await client.getSchema("nms:extAccount");
            expect(schema["namespace"]).toBe("nms");
            expect(schema["name"]).toBe("extAccount");

            client._transport.mockReturnValueOnce(Promise.resolve(Mock.GETMODIFIEDENTITIES_SCHEMA_RESPONSE));
            client._transport.mockReturnValueOnce(Promise.resolve(Mock.GETMODIFIEDENTITIES_SCHEMA_RESPONSE));

            client._transport.mockReturnValue(Promise.resolve(Mock.GET_NMS_EXTACCOUNT_SCHEMA_RESPONSE));
            jest.useFakeTimers();
            client.startRefreshCaches(5000); // autorefresh every 5000 ms
            jest.advanceTimersByTime(6000);
            jest.useRealTimers();

            schema = await client.getSchema("nms:extAccount");
            expect(schema["namespace"]).toBe("nms");
            expect(schema["name"]).toBe("extAccount");
            client.stopRefreshCaches();
        });

        it("Should stop refresh", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            jest.useFakeTimers();
            client.startRefreshCaches();
            jest.advanceTimersByTime(6000); // autorefresh for xtk:schema should be started after 5000 ms
            jest.useRealTimers();
            expect(client._optionCacheRefresher._intervalId).not.toBeNull();
            expect(client._entityCacheRefresher._intervalId).not.toBeNull();
            client.stopRefreshCaches();
            expect(client._optionCacheRefresher._intervalId).toBeNull();
            expect(client._entityCacheRefresher._intervalId).toBeNull();
        });

        it("Should stop refresh when logoff", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            jest.useFakeTimers();
            client.startRefreshCaches();
            jest.advanceTimersByTime(6000); // autorefresh for xtk:schema should be started after 5000 ms
            jest.useRealTimers();
            expect(client._optionCacheRefresher._intervalId).not.toBeNull();
            expect(client._entityCacheRefresher._intervalId).not.toBeNull();
            client._transport.mockReturnValueOnce(Mock.LOGOFF_RESPONSE);
            await client.logoff();
            expect(client._optionCacheRefresher._intervalId).toBeNull();
            expect(client._entityCacheRefresher._intervalId).toBeNull();
        });

        it("Expired session and refresh cache", async () => {
            let refreshClient = async () => {
                const connectionParameters = sdk.ConnectionParameters.ofSecurityToken("http://acc-sdk:8080",
                                                        "$security_token$", {refreshClient: refreshClient});
                const newClient = await sdk.init(connectionParameters);
                newClient._transport = jest.fn();
                newClient._transport.mockReturnValueOnce(Mock.BEARER_LOGON_RESPONSE);
                await newClient.logon();
                return newClient;
            }
            const connectionParameters = sdk.ConnectionParameters.ofBearerToken("http://acc-sdk:8080",
                                                    "$token$", {refreshClient: refreshClient});
            const client = await sdk.init(connectionParameters);
            jest.useFakeTimers();
            client.startRefreshCaches();
            client._entityCacheRefresher._safeCallAndRefresh = jest.fn();
            client._optionCacheRefresher._safeCallAndRefresh = jest.fn();
            jest.advanceTimersByTime(18000);
            expect(client._entityCacheRefresher._safeCallAndRefresh.mock.calls.length).toBe(1);
            expect(client._optionCacheRefresher._safeCallAndRefresh.mock.calls.length).toBe(1);
            client.traceAPICalls(true);
            client._transport = jest.fn();
            client._transport.mockReturnValueOnce(Mock.BEARER_LOGON_RESPONSE);
            client._transport.mockReturnValueOnce(Promise.resolve(`XSV-350008 Session has expired or is invalid. Please reconnect.`));
            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0'?>
                <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:xtk:queryDef' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
                <SOAP-ENV:Body>
                <ExecuteQueryResponse xmlns='urn:xtk:queryDef' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                    <pdomOutput xsi:type='ns:Element' SOAP-ENV:encodingStyle='http://xml.apache.org/xml-soap/literalxml'>
                    <extAccount-collection/>
                    </pdomOutput></ExecuteQueryResponse>
                </SOAP-ENV:Body>
                </SOAP-ENV:Envelope>`));
            await client.logon();
            var queryDef = {
                "schema": "nms:extAccount",
                "operation": "select",
                "select": {
                    "node": [
                        { "expr": "@id" },
                        { "expr": "@name" }
                    ]
                }
            };
            var query = client.NLWS.xtkQueryDef.create(queryDef);
            var extAccount = await query.executeQuery();
            expect(extAccount).toEqual({ extAccount: [] });
            jest.advanceTimersByTime(10000);
            expect(client._entityCacheRefresher._safeCallAndRefresh.mock.calls.length).toBe(2);
            expect(client._optionCacheRefresher._safeCallAndRefresh.mock.calls.length).toBe(2);
            jest.useRealTimers();
        });
    });

    describe("Calling SOAP method with parameters as a function", () => {
        it("Should make SOAP call", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_DATABASEID_RESPONSE);
            const scope = client.NLWS["xtkSession"];
            const fn = scope["getOption"];
            const result = await fn.call(scope, "XtkDatabaseId");
            expect(result).toMatchObject([ "uFE80000000000000F1FA913DD7CC7C480041161C", 6 ]);
        });

        it("Should make static SOAP call with functional parameters", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            const scope = client.NLWS["xtkSession"];
            const method = scope["staticP1"]; // SOAP method to call
            const paramsFn = jest.fn(); // function returning SOAP call parameters
            paramsFn.mockReturnValueOnce(["XtkDatabaseId"]);

            client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0'?>
                <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:xtk:session' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
                <SOAP-ENV:Body>
                    <StaticP1Response xmlns='urn:xtk:session' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                    </StaticP1Response>
                </SOAP-ENV:Body>
                </SOAP-ENV:Envelope>`));

            const result = await method.call(scope, paramsFn);
            expect(result).toBeNull();
            expect(paramsFn.mock.calls.length).toBe(1);
            // first parameter is the XML method
            const xmlMethod = paramsFn.mock.calls[0][0];
            expect(EntityAccessor.getAttributeAsString(xmlMethod, "name")).toBe("StaticP1");
            // second parameter is the call context
            expect(paramsFn.mock.calls[0][1]).toMatchObject({ schemaId: "xtk:session", namespace: "xtkSession" });
        });

        it("Should make non static SOAP call with functional parameters", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);
            const scope = client.NLWS["xtkSession"];
            const method = scope["nonStaticP1"]; // SOAP method to call
            const paramsFn = jest.fn(); // function returning SOAP call parameters
            paramsFn.mockReturnValueOnce(["XtkDatabaseId"]);

            client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0'?>
                <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:xtk:session' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
                <SOAP-ENV:Body>
                    <StaticP1Response xmlns='urn:xtk:session' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                    </StaticP1Response>
                </SOAP-ENV:Body>
                </SOAP-ENV:Envelope>`));

            const object = scope.create({ dummy: true }); // "this" object for the non-static SOAP call
            const result = await method.call(object, paramsFn);
            expect(result).toBeNull();
            expect(paramsFn.mock.calls.length).toBe(1);
            // first parameter is the XML method
            const xmlMethod = paramsFn.mock.calls[0][0];
            expect(EntityAccessor.getAttributeAsString(xmlMethod, "name")).toBe("NonStaticP1");
            // second parameter is the call context
            expect(paramsFn.mock.calls[0][1]).toMatchObject({ schemaId: "xtk:session", namespace: "xtkSession" });
        });
    });

    describe("Method-level representation", () => {
        it("Should force an xml representation", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_QUERY_EXECUTE_RESPONSE);
            const queryDef = DomUtil.parse(`
                <queryDef schema="nms:extAccount" operation="select">
                    <select>
                        <node expr="@id"/>
                        <node expr="@name"/>
                    </select>
                </queryDef>
            `);
            const query = client.NLWS.xml.xtkQueryDef.create(queryDef);
            const result = await query.executeQuery();
            const xml = DomUtil.toXMLString(result);
            expect(xml).toBe(`<extAccount-collection xmlns="urn:xtk:queryDef">
            <extAccount id="1816" name="defaultPopAccount"/>
            <extAccount id="1818" name="defaultOther"/>
            <extAccount id="1849" name="billingReport"/>
            <extAccount id="12070" name="TST_EXT_ACCOUNT_POSTGRESQL"/>
            <extAccount id="1817" name="defaultEmailBulk"/>
            <extAccount id="2087" name="ffda"/>
            <extAccount id="2088" name="defaultEmailMid"/>
        </extAccount-collection>`);
        });

        it("Should force an json representation", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_QUERY_EXECUTE_RESPONSE);
            const queryDef = {
                "schema": "nms:extAccount",
                "operation": "select",
                "select": {
                    "node": [
                        { "expr": "@id" },
                        { "expr": "@name" }
                    ]
                }
            };
            const query = client.NLWS.json.xtkQueryDef.create(queryDef);
            const result = await query.executeQuery();
            const json = JSON.stringify(result);
            expect(json).toBe('{"#text":[],"extAccount":[{"id":"1816","name":"defaultPopAccount"},{"id":"1818","name":"defaultOther"},{"id":"1849","name":"billingReport"},{"id":"12070","name":"TST_EXT_ACCOUNT_POSTGRESQL"},{"id":"1817","name":"defaultEmailBulk"},{"id":"2087","name":"ffda"},{"id":"2088","name":"defaultEmailMid"}]}');
        });
    });

    describe('Support for int type parameters such as nms:extAccount#UpdateMCSynchWkf', () => {
        it("Should call nms:extAccount#UpdateMCSynchWkf", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0'?>
            <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:wpp:default' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
            <SOAP-ENV:Body>
                <GetEntityIfMoreRecentResponse xmlns='urn:wpp:default' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
                    <pdomDoc xsi:type='ns:Element' SOAP-ENV:encodingStyle='http://xml.apache.org/xml-soap/literalxml'>
                        <schema name="extAccount" namespace="nms" xtkschema="xtk:schema">
                            <element name="extAccount"></element>
                            <methods>
                                <method library="nms:messageCenter.js" name="UpdateMCSynchWkf" static="true" hidden="true">
                                <parameters>
                                    <param name="extAccountId" type="int" desc="Message Center external account identifier"/>
                                </parameters>
                            </method>
                            </methods>
                        </schema>
                    </pdomDoc>
                </GetEntityIfMoreRecentResponse>
            </SOAP-ENV:Body>
            </SOAP-ENV:Envelope>`));

            client._transport.mockReturnValueOnce(Promise.resolve(`<?xml version='1.0'?>
            <SOAP-ENV:Envelope xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:ns='urn:nms:extAccount' xmlns:SOAP-ENV='http://schemas.xmlsoap.org/soap/envelope/'>
            <SOAP-ENV:Body>
            <UpdateMCSynchWkfResponse xmlns='urn:nms:extAccount' SOAP-ENV:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'>
            </UpdateMCSynchWkfResponse>
            </SOAP-ENV:Body>
            </SOAP-ENV:Envelope>`));

            await client.NLWS.nmsExtAccount.updateMCSynchWkf(1);
        })
    });

    describe("Method-level HTTP headers", () => {
        it("Should set header", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_QUERY_EXECUTE_RESPONSE);
            const queryDef = {
                "schema": "nms:extAccount",
                "operation": "select",
                "select": {
                    "node": [
                        { "expr": "@id" },
                        { "expr": "@name" }
                    ]
                }
            };
            const query = client.NLWS.headers({'X-Test': 'hello'}).xtkQueryDef.create(queryDef);

            let headers = {};
            client.registerObserver({
                onSOAPCall: (soapCall) => {
                    const request = soapCall.request;
                    headers = request.headers;
                }
            });
            await query.executeQuery();
            expect(headers).toMatchObject({
                "SoapAction": "xtk:queryDef#ExecuteQuery",
                "X-Test": "hello"
            });
        });

        it("Should support global and method-level http headers", async () => {
            const client = await Mock.makeClient({
                extraHttpHeaders: {
                    "X-Test": "world",
                    "X-Test-Global": "global"
                }
            });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_QUERY_EXECUTE_RESPONSE);
            const queryDef = {
                "schema": "nms:extAccount",
                "operation": "select",
                "select": {
                    "node": [
                        { "expr": "@id" },
                        { "expr": "@name" }
                    ]
                }
            };
            const query = client.NLWS.headers({'X-Test': 'hello'}).xtkQueryDef.create(queryDef);

            let headers = {};
            client.registerObserver({
                onSOAPCall: (soapCall) => {
                    const request = soapCall.request;
                    headers = request.headers;
                }
            });
            await query.executeQuery();
            expect(headers).toMatchObject({
                "SoapAction": "xtk:queryDef#ExecuteQuery",
                "X-Test": "hello",
                "X-Test-Global": "global"
            });
        })

        it("Should support undefined method headers", async () => {
            const client = await Mock.makeClient({
                extraHttpHeaders: {
                    "X-Test": "world",
                    "X-Test-Global": "global"
                }
            });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_QUERY_EXECUTE_RESPONSE);
            const queryDef = {
                "schema": "nms:extAccount",
                "operation": "select",
                "select": {
                    "node": [
                        { "expr": "@id" },
                        { "expr": "@name" }
                    ]
                }
            };
            // missing headers
            const query = client.NLWS.headers().xtkQueryDef.create(queryDef);

            let headers = {};
            client.registerObserver({
                onSOAPCall: (soapCall) => {
                    const request = soapCall.request;
                    headers = request.headers;
                }
            });
            await query.executeQuery();
            expect(headers).toMatchObject({
                "SoapAction": "xtk:queryDef#ExecuteQuery",
                "X-Test": "world",
                "X-Test-Global": "global"
            });
        })

        it("Should set http headers with an xml representation", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_QUERY_EXECUTE_RESPONSE);
            const queryDef = DomUtil.parse(`
                <queryDef schema="nms:extAccount" operation="select">
                    <select>
                        <node expr="@id"/>
                        <node expr="@name"/>
                    </select>
                </queryDef>
            `);
            const query = client.NLWS
                .headers({'X-Test': 'hello', 'X-Test-Before': 'before'})
                .xml
                .headers({'X-Test': 'world', 'X-Test-After': 'after'})
                .xtkQueryDef.create(queryDef);
                let headers = {};
                client.registerObserver({
                    onSOAPCall: (soapCall) => {
                        const request = soapCall.request;
                        headers = request.headers;
                    }
                });
                await query.executeQuery();
                console.log(headers);
                expect(headers).toMatchObject({
                    "SoapAction": "xtk:queryDef#ExecuteQuery",
                    "X-Test": "world",
                    "X-Test-Before": "before",
                    "X-Test-After": "after"
                });
        });
    });

    describe("ACC-SDK HTTP headers", () => {

        const collectHeaders = async (client, callback) => {
            let headers = {};
            client.registerObserver({
                onSOAPCall: (soapCall) => {
                    const request = soapCall.request;
                    headers = request.headers;
                },
                onHTTPCall: (request) => {
                    headers = request.headers;
                }
            });
            await callback();
            return headers;
        };

        it("Should set headers by default", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_QUERY_EXECUTE_RESPONSE);
            const queryDef = {
                "schema": "nms:extAccount",
                "operation": "select",
                "select": {
                    "node": [
                        { "expr": "@id" },
                        { "expr": "@name" }
                    ]
                }
            };
            const query = client.NLWS.xtkQueryDef.create(queryDef);

            const headers = await collectHeaders(client, async() => {
                await query.executeQuery();
            });

            expect(headers).toMatchObject({
                "ACC-SDK-Version": `${sdk.getSDKVersion().name} ${sdk.getSDKVersion().version}`,
                "ACC-SDK-Auth": "UserPassword admin",
                "X-Query-Source": `${sdk.getSDKVersion().name} ${sdk.getSDKVersion().version}`,
            });
            // This header is only set if "clientApp" connection parameter is set
            expect(headers["ACC-SDK-Client-App"]).toBeUndefined();
        });

        it("Should disable ACC-SDK headers", async () => {
            const client = await Mock.makeClient({
                noSDKHeaders: true
            });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_QUERY_EXECUTE_RESPONSE);
            const queryDef = {
                "schema": "nms:extAccount",
                "operation": "select",
                "select": {
                    "node": [
                        { "expr": "@id" },
                        { "expr": "@name" }
                    ]
                }
            };
            const query = client.NLWS.xtkQueryDef.create(queryDef);

            const headers = await collectHeaders(client, async() => {
                await query.executeQuery();
            });
            expect(headers["ACC-SDK-Version"]).toBeUndefined();
            expect(headers["ACC-SDK-Auth"]).toBeUndefined();
            expect(headers["X-Query-Source"]).toBe(`${sdk.getSDKVersion().name} ${sdk.getSDKVersion().version}`);
        });

        it("Should support ACC-SDK-Client-App header", async () => {
            const client = await Mock.makeClient({
                clientApp: 'Test client app'
            });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_QUERY_EXECUTE_RESPONSE);
            const queryDef = {
                "schema": "nms:extAccount",
                "operation": "select",
                "select": {
                    "node": [
                        { "expr": "@id" },
                        { "expr": "@name" }
                    ]
                }
            };
            const query = client.NLWS.xtkQueryDef.create(queryDef);

            const headers = await collectHeaders(client, async() => {
                await query.executeQuery();
            });
            expect(headers).toMatchObject({
                "ACC-SDK-Version": `${sdk.getSDKVersion().name} ${sdk.getSDKVersion().version}`,
                "ACC-SDK-Auth": "UserPassword admin",
                "ACC-SDK-Client-App": "Test client app",
                "X-Query-Source": `${sdk.getSDKVersion().name} ${sdk.getSDKVersion().version},Test client app`,
            });
        });

        it("Should set ACC-SDK headers on ping JSP", async () => {
            const client = await Mock.makeClient({
                clientApp: 'Test client app'
            });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            const headers = await collectHeaders(client, async() => {
                client._transport.mockReturnValueOnce(Mock.PING);
                await client.ping();
            });
            expect(headers).toMatchObject({
                "ACC-SDK-Version": `${sdk.getSDKVersion().name} ${sdk.getSDKVersion().version}`,
                "ACC-SDK-Auth": "UserPassword admin",
                "ACC-SDK-Client-App": "Test client app",
                "X-Query-Source": `${sdk.getSDKVersion().name} ${sdk.getSDKVersion().version},Test client app`,
            });
        });

        it("Should set ACC-SDK headers on mcping JSP", async () => {
            const client = await Mock.makeClient({
                clientApp: 'Test client app'
            });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            const headers = await collectHeaders(client, async() => {
                client._transport.mockReturnValueOnce(Mock.MC_PING);
                await client.mcPing();
            });
            expect(headers).toMatchObject({
                "ACC-SDK-Version": `${sdk.getSDKVersion().name} ${sdk.getSDKVersion().version}`,
                "ACC-SDK-Auth": "UserPassword admin",
                "ACC-SDK-Client-App": "Test client app",
                "X-Query-Source": `${sdk.getSDKVersion().name} ${sdk.getSDKVersion().version},Test client app`,
            });
        });
    });

    describe("Pushdown parameters", () => {
        it("Should push down custom parameters", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_QUERY_EXECUTE_RESPONSE);
            const queryDef = {
                "schema": "nms:extAccount",
                "operation": "select",
                "select": {
                    "node": [
                        { "expr": "@id" },
                        { "expr": "@name" }
                    ]
                }
            };
            // Pushing down the foo=bar attributes
            const query = client.NLWS.pushDown({'foo': 'bar'}).xtkQueryDef.create(queryDef);
            await query.executeQuery();
            const lastCall = client._transport.mock.calls[client._transport.mock.calls.length-1];
            expect(lastCall[0].url).toBe("http://acc-sdk:8080/nl/jsp/soaprouter.jsp?xtk:queryDef:ExecuteQuery");
            expect(lastCall[1].charset).toBe("UTF-8");
            expect(lastCall[1].foo).toBe("bar");
        });

        it("Should push down custom parameters defined at the connection level", async () => {
            const client = await Mock.makeClient({ 'cnxDefault': 3, 'foo': 'foo' });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_QUERY_EXECUTE_RESPONSE);
            const queryDef = {
                "schema": "nms:extAccount",
                "operation": "select",
                "select": {
                    "node": [
                        { "expr": "@id" },
                        { "expr": "@name" }
                    ]
                }
            };
            // Pushing down the foo=bar attributes (should overload the "foo" set in connecion parameters)
            const query = client.NLWS.pushDown({'foo': 'bar'}).xtkQueryDef.create(queryDef);
            await query.executeQuery();
            const lastCall = client._transport.mock.calls[client._transport.mock.calls.length-1];
            expect(lastCall[0].url).toBe("http://acc-sdk:8080/nl/jsp/soaprouter.jsp?xtk:queryDef:ExecuteQuery");
            expect(lastCall[1].charset).toBe("UTF-8");
            expect(lastCall[1].foo).toBe("bar");
            expect(lastCall[1].cnxDefault).toBe(3);
        });

        it("Should chain push options", async () => {
            const client = await Mock.makeClient({ 'cnxDefault': 3, 'foo': 'foo' });
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();
            client._transport.mockReturnValueOnce(Mock.GET_XTK_QUERY_SCHEMA_RESPONSE);
            client._transport.mockReturnValueOnce(Mock.GET_QUERY_EXECUTE_RESPONSE);
            const queryDef = {
                "schema": "nms:extAccount",
                "operation": "select",
                "select": {
                    "node": [
                        { "expr": "@id" },
                        { "expr": "@name" }
                    ]
                }
            };
            // Supports multiple calls to pushDown. each one overrides the previous in case of duplicate key
            // Also supports undefined
            const query = client.NLWS.pushDown({'foo': 'bar'}).pushDown().pushDown({'foo': 'fu', x: 2 }).xtkQueryDef.create(queryDef);
            await query.executeQuery();
            const lastCall = client._transport.mock.calls[client._transport.mock.calls.length-1];
            expect(lastCall[0].url).toBe("http://acc-sdk:8080/nl/jsp/soaprouter.jsp?xtk:queryDef:ExecuteQuery");
            expect(lastCall[1].charset).toBe("UTF-8");
            expect(lastCall[1].foo).toBe("fu");
            expect(lastCall[1].cnxDefault).toBe(3);
            expect(lastCall[1].x).toBe(2);
        });
    });
    describe("Schema cache refresh", () => {
        it("Should unregister listener", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            class Listener {
                constructor() {
                    this._schemas = {};
                }

                invalidateCacheItem(schemaId) {
                    this._schemas[schemaId] = undefined;
                }
            }

            client._unregisterAllCacheChangeListeners();
            expect(client._cacheChangeListeners.length).toBe(0);
            const listener = new Listener();

            client._registerCacheChangeListener(listener);
            expect(client._cacheChangeListeners.length).toBe(1);
            client._unregisterCacheChangeListener(listener);
            expect(client._cacheChangeListeners.length).toBe(0);
        });

        it("Should not unregister unknown listener", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            class Listener {
                constructor() {
                    this._schemas = {};
                }

                invalidateCacheItem(schemaId) {
                    this._schemas[schemaId] = undefined;
                }
            }

            client._unregisterAllCacheChangeListeners();
            expect(client._cacheChangeListeners.length).toBe(0);
            const listener = new Listener();

            client._registerCacheChangeListener(listener);
            expect(client._cacheChangeListeners.length).toBe(1);

            const listener2 = new Listener();

            client._unregisterCacheChangeListener(listener2);
            expect(client._cacheChangeListeners.length).toBe(1);
            client._unregisterAllCacheChangeListeners();
        });

        it("Should be notify when register", async () => {
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            class Listener {
                constructor() {
                    this._schemas = {};
                }
                add(schemaId) {
                    this._schemas[schemaId] = "1";
                }

                invalidateCacheItem(schemaId) {
                    this._schemas[schemaId] = undefined;
                }
                getSchema(schemaId) {
                    return this._schemas[schemaId];
                }
            }

            client._unregisterAllCacheChangeListeners();

            const listener = new Listener();
            listener.add("nms:recipient");
            listener.add("xtk:operator");

            client._registerCacheChangeListener(listener);
            client._notifyCacheChangeListeners("nms:recipient");
            expect(listener.getSchema("nms:recipient")).toBeUndefined();
            expect(listener.getSchema("xtk:operator")).toBe("1");

            client._unregisterCacheChangeListener(listener);
        });
    });
    describe('File uploader - on server', () => {
        it('is not supported', async ()=> {
            const client = await Mock.makeClient();
            expect(client.fileUploader).toBeDefined()
            await expect(client.fileUploader.upload({name: 'abcd.txt'})).rejects.toMatchObject({"cause": undefined, "detail": "File uploading is only supported in browser based calls.", "errorCode": "SDK-000013", "faultCode": 16384, "faultString": "\"Failed to upload file abcd.txt", "message": "500 - Error 16384: SDK-000013 \"Failed to upload file abcd.txt. File uploading is only supported in browser based calls.", "methodCall": undefined, "name": "CampaignException", "statusCode": 500})
        })
    })

    describe('File uploader - on browser', () => {
        beforeEach(() => {
            global.document = dom.window.document
            global.window = dom.window
            global.FormData = function () {
                this.append = jest.fn()
            }

            // Evaluates JavaScript code returned by the upload.jsp. Evaluation is done in the context
            // of an iframe and will call the parent window document.controller uploadFileCallBack
            // function
            function evalJSReturnedByUploadJSP(js) {
                const data = eval(`
                (function () {
                    var result = undefined;
                    window = {
                        parent: {
                            document: {
                                controller: {
                                    uploadFileCallBack: (data) => {
                                        result = data;
                                    }
                                }
                            }
                        }
                    };
                    ${js};
                    return result;
                }())
            `);
                // Call real callback
                global.document.controller.uploadFileCallBack(data);
            }

            // Dynamically mock the iframe.contentWindow.document.close(); function
            const handler = {
                get: function (target, prop) {
                    if (prop === 'contentWindow') {
                        target.contentWindow.document.close = () => {
                            var scripts = target.contentWindow.document.getElementsByTagName('script');
                            for (let i = 0; i < scripts.length; i++) {
                                const script = scripts[i];
                                const js = DomUtil.elementValue(script);
                                evalJSReturnedByUploadJSP(js);
                            }
                        }
                    }
                    return Reflect.get(...arguments);
                }
            };


            // Intercept creation of iframe. returns a proxy which will intercept the iframe.contentWindow.document.close(); function
            const _origiinalCreateElement = document.createElement;
            global.document.createElement = (tagName) => {
                const r = _origiinalCreateElement.call(document, tagName);
                if (tagName === 'iframe') {
                    const p = new Proxy(r, handler);
                    return p;
                }
                return r;
            };

        });

        it('works with successful post upload calls', async () => {
            // Create a mock client and logon
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            // Mock the upload protocol
            // - the upload.jsp (which returns the content of an iframe and JS to eval)
            // - call to xtk:counter#IncreaseValue (first, retrieve the schema xtk:counter then call the function)
            // - call to xtk:session#Write
            // - call to xtk:fileRes#PublishIfNeeded
            // - call to xtk:fileRes#GetURL

            client._transport.mockReturnValueOnce(Promise.resolve(`Ok 
        <html xmlns="http://www.w3.org/1999/xhtml">
            <head>
              <script type="text/javascript">if(window.parent&&window.parent.document.controller&&"function"==typeof window.parent.document.controller.uploadFileCallBack){var aFilesInfo=new Array;aFilesInfo.push({paramName:"file",fileName:"test.txt",newFileName:"d8e8fca2dc0f896fd7cb4cb0031ba249.txt",md5:"d8e8fca2dc0f896fd7cb4cb0031ba249"}),window.parent.document.controller.uploadFileCallBack(aFilesInfo)}</script>
            </head>
        <body></body>
        </html>`)); // upload.jsp

            client._transport.mockReturnValueOnce(Promise.resolve(Mock.GET_XTK_COUNTER_RESPONSE)); // GetEntityIfMoreRecentResponse - counter
            client._transport.mockReturnValueOnce(Mock.INCREASE_VALUE_RESPONSE); // xtk:counter#IncreaseValue

            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE); // GetEntityIfMoreRecentResponse - session
            client._transport.mockReturnValueOnce(Mock.FILE_RES_WRITE_RESPONSE); // xtk:session#Write

            client._transport.mockReturnValueOnce(Promise.resolve(Mock.GET_FILERES_QUERY_SCHEMA_RESPONSE)); // GetEntityIfMoreRecentResponse - fileRes
            client._transport.mockReturnValueOnce(Promise.resolve(Mock.PUBLISH_IF_NEEDED_RESPONSE)); // xtk:fileRes#PublishIfNeeded

            client._transport.mockReturnValueOnce(Promise.resolve(Mock.GET_URL_RESPONSE)); // xtk:fileRes#GetURL

            // Call upload
            const result = await client.fileUploader.upload({
                type: 'text/html',
                size: 12345
            })
            expect(result).toMatchObject({
                md5: "d8e8fca2dc0f896fd7cb4cb0031ba249",
                name: "test.txt",
                size: 12345,
                type: "text/html",
                url: "http://hello.com"
            });
        })

        it('throws error with dependant failures', async () => {
            // Create a mock client and logon
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            // Mock the upload protocol
            // - the upload.jsp (which returns the content of an iframe and JS to eval)
            // - call to xtk:counter#IncreaseValue (first, retrieve the schema xtk:counter then call the function)
            // - call to xtk:session#Write
            // - call to xtk:fileRes#PublishIfNeeded
            // - call to xtk:fileRes#GetURL

            client._transport.mockReturnValueOnce(Promise.reject(`Some error occurred!!!`));  // upload.jsp

            client._transport.mockReturnValueOnce(Promise.resolve(Mock.GET_XTK_COUNTER_RESPONSE));  // GetEntityIfMoreRecentResponse - counter
            client._transport.mockReturnValueOnce(Mock.INCREASE_VALUE_RESPONSE);

            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);  // GetEntityIfMoreRecentResponse - session
            client._transport.mockReturnValueOnce(Mock.FILE_RES_WRITE_RESPONSE);  // xtk:session#Write

            client._transport.mockReturnValueOnce(Promise.resolve(Mock.GET_FILERES_QUERY_SCHEMA_RESPONSE));  // GetEntityIfMoreRecentResponse - fileRes
            client._transport.mockReturnValueOnce(Promise.resolve(Mock.PUBLISH_IF_NEEDED_RESPONSE));  // xtk:fileRes#PublishIfNeeded

            client._transport.mockReturnValueOnce(Promise.resolve(Mock.GET_URL_RESPONSE));  // xtk:fileRes#GetURL
            // For async handling
            expect.assertions(1)
            // Call upload
            await client.fileUploader.upload({
                type: 'text/html',
                size: 12345,
                name: 'abcd.txt'
            }).catch((ex) => {
                expect(ex.message).toMatch('500 - Error 16384: SDK-000013 "Failed to upload file abcd.txt. 500 - Error calling method \'/nl/jsp/uploadFile.jsp\': Some error occurred!!!');
            })

        })

        it('throws error with not okay response', async () => {
            // Create a mock client and logon
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            // Mock the upload protocol
            // - the upload.jsp (which returns the content of an iframe and JS to eval)
            // - call to xtk:counter#IncreaseValue (first, retrieve the schema xtk:counter then call the function)
            // - call to xtk:session#Write
            // - call to xtk:fileRes#PublishIfNeeded
            // - call to xtk:fileRes#GetURL

            client._transport.mockReturnValueOnce(Promise.resolve(`Some error occurred!!!`));  // upload.jsp

            client._transport.mockReturnValueOnce(Promise.resolve(Mock.GET_XTK_COUNTER_RESPONSE));  // GetEntityIfMoreRecentResponse - counter
            client._transport.mockReturnValueOnce(Mock.INCREASE_VALUE_RESPONSE);

            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);  // GetEntityIfMoreRecentResponse - session
            client._transport.mockReturnValueOnce(Mock.FILE_RES_WRITE_RESPONSE);  // xtk:session#Write

            client._transport.mockReturnValueOnce(Promise.resolve(Mock.GET_FILERES_QUERY_SCHEMA_RESPONSE));  // GetEntityIfMoreRecentResponse - fileRes
            client._transport.mockReturnValueOnce(Promise.resolve(Mock.PUBLISH_IF_NEEDED_RESPONSE));  // xtk:fileRes#PublishIfNeeded

            client._transport.mockReturnValueOnce(Promise.resolve(Mock.GET_URL_RESPONSE));  // xtk:fileRes#GetURL
            // For async handling
            expect.assertions(1)
            // Call upload
            await client.fileUploader.upload({
                type: 'text/html',
                size: 12345,
                name: 'abcd.txt'
            }).catch((ex) => {
                expect(ex.message).toMatch('500 - Error 16384: SDK-000013 "Failed to upload file abcd.txt. Some error occurred!!!');
            })

        })

        it('throws error with malformed response', async () => {
            // Create a mock client and logon
            const client = await Mock.makeClient();
            client._transport.mockReturnValueOnce(Mock.LOGON_RESPONSE);
            await client.NLWS.xtkSession.logon();

            // Mock the upload protocol
            // - the upload.jsp (which returns the content of an iframe and JS to eval)
            // - call to xtk:counter#IncreaseValue (first, retrieve the schema xtk:counter then call the function)
            // - call to xtk:session#Write
            // - call to xtk:fileRes#PublishIfNeeded
            // - call to xtk:fileRes#GetURL

            client._transport.mockReturnValueOnce(Promise.resolve(`Ok 
        <html xmlns="http://www.w3.org/1999/xhtml">
            <head>
              <script type="text/javascript">if(window.parent&&window.parent.document.controller&&"function"==typeof window.parent.document.controller.uploadFileCallBack){window.parent.document.controller.uploadFileCallBack([])}</script>
            </head>
        <body></body>
        </html>`)); // upload.jsp

            client._transport.mockReturnValueOnce(Promise.resolve(Mock.GET_XTK_COUNTER_RESPONSE));  // GetEntityIfMoreRecentResponse - counter
            client._transport.mockReturnValueOnce(Mock.INCREASE_VALUE_RESPONSE);

            client._transport.mockReturnValueOnce(Mock.GET_XTK_SESSION_SCHEMA_RESPONSE);  // GetEntityIfMoreRecentResponse - session
            client._transport.mockReturnValueOnce(Mock.FILE_RES_WRITE_RESPONSE);  // xtk:session#Write

            client._transport.mockReturnValueOnce(Promise.resolve(Mock.GET_FILERES_QUERY_SCHEMA_RESPONSE));  // GetEntityIfMoreRecentResponse - fileRes
            client._transport.mockReturnValueOnce(Promise.resolve(Mock.PUBLISH_IF_NEEDED_RESPONSE));  // xtk:fileRes#PublishIfNeeded

            client._transport.mockReturnValueOnce(Promise.resolve(Mock.GET_URL_RESPONSE));  // xtk:fileRes#GetURL
            // For async handling
            expect.assertions(1)
            // Call upload
            await client.fileUploader.upload({
                type: 'text/html',
                size: 12345,
                name: 'abcd.txt'
            }).catch((ex) => {
                expect(ex.message).toMatch('500 - Error 16384: SDK-000013 "Failed to upload file abcd.txt. Malformed data:');
            })

        })
    })
});
