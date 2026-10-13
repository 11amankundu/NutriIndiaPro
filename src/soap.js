// SOAP demonstration. A local mock SOAP service (described by src/nutrition.wsdl) is mounted at /soap/nutrition,
// and a SOAP *client* reads the WSDL over HTTP, discovers the operation and executes one call.
const fs = require('fs');
const express = require('express');
const path = require('path');
const soap = require('soap');
const { withTimeout, UpstreamError } = require('./resilience');

const WSDL_FILE = path.join(__dirname, 'nutrition.wsdl');
const SERVICE_PATH = '/soap/nutrition';

function mountSoapService(app, svc) {
  const wsdlXml = fs.readFileSync(WSDL_FILE, 'utf8');
  const service = {
    NutritionService: {
      NutritionPort: {
        GetFoodNutrition(args) {
          const f = svc.findFoodByName(String(args.foodName || ''));
          if (!f) throw { Fault: { faultcode: 'soap:Client', faultstring: `Food not found: ${args.foodName}` } }; // eslint-disable-line no-throw-literal
          return { name: f.name, servingDesc: f.servingDesc, calories: f.calories, proteinG: f.proteinG };
        },
      },
    },
  };
  // soap.listen registers its route asynchronously (after the WSDL is parsed), so give it its own router that is
  // already in the middleware stack - otherwise the route would be added after the 404 handler.
  const router = express.Router();
  soap.listen(router, SERVICE_PATH, service, wsdlXml);
  app.use(router);
}

async function callGetFoodNutrition({ baseUrl, foodName, timeoutMs }) {
  const wsdlUrl = `${baseUrl}${SERVICE_PATH}?wsdl`;
  try {
    // 1) read + parse the WSDL (timeout applies to the WSDL download too)
    const client = await withTimeout(
      soap.createClientAsync(wsdlUrl, { wsdl_options: { timeout: timeoutMs } }), timeoutMs, 'WSDL download');
    client.setEndpoint(`${baseUrl}${SERVICE_PATH}`);
    const operations = Object.keys(client.describe().NutritionService.NutritionPort);
    // 2) execute one SOAP call
    const [result] = await withTimeout(
      client.GetFoodNutritionAsync({ foodName }, { timeout: timeoutMs }), timeoutMs, 'SOAP call');
    return { wsdlUrl, operations, requestXml: client.lastRequest, responseXml: client.lastResponse, result };
  } catch (e) {
    if (e instanceof UpstreamError) throw e;
    const fault = e.root && e.root.Envelope && e.root.Envelope.Body && e.root.Envelope.Body.Fault;
    if (fault) { // a SOAP Fault is an answer, not an outage: do not retry, do not trip the breaker
      const err = new UpstreamError(String(fault.faultstring || 'SOAP fault'), { status: 404, retryable: false });
      err.soapFault = true;
      throw err;
    }
    throw new UpstreamError(`SOAP service unreachable: ${e.message}`);
  }
}

module.exports = { mountSoapService, callGetFoodNutrition };
