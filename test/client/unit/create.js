'use strict';

var Client = require('../../../src/client/client');
var client = require('../../../src/client');
var AJAXDriver = require('../../../src/client/request/ajax-driver');
var BraintreeError = require('../../../src/lib/error');
var fake = require('../../helpers/fake');

describe('client.create', function () {
  beforeEach(function () {
    this.getSpy = this.sandbox.stub(AJAXDriver, 'request', function (options, cb) {
      var configuration = fake.configuration().gatewayConfiguration;

      configuration.unionPay = {
        enabled: true
      };
      cb(null, fake.configuration().gatewayConfiguration);
    });
  });

  it('errors out if no authorization given', function (done) {
    client.create({}, function (err, thingy) {
      expect(err).to.be.an.instanceOf(BraintreeError);
      expect(err.type).to.equal('MERCHANT');
      expect(err.message).to.equal('options.authorization is required.');
      expect(thingy).not.to.exist;
      done();
    });
  });

  it('throws an error if no callback is provided', function () {
    var expectedError = new BraintreeError({
      type: BraintreeError.types.MERCHANT,
      message: 'create must include a callback function'
    });

    expect(function () {
      client.create({authorization: fake.tokenizationKey});
    }).to.throw(BraintreeError, expectedError);
  });

  it('accepts a tokenizationKey', function (done) {
    var self = this;

    client.create({authorization: fake.tokenizationKey}, function (err, thingy) {
      expect(err).to.be.null;
      expect(thingy).to.be.an.instanceof(Client);
      expect(self.getSpy).to.have.been.calledWith(sinon.match({
        data: {tokenizationKey: fake.tokenizationKey}
      }));
      done();
    });
  });

  it('accepts a clientToken', function (done) {
    var self = this;
    var fingerprint = JSON.parse(atob(fake.clientToken)).authorizationFingerprint;

    client.create({authorization: fake.clientToken}, function (err, thingy) {
      expect(err).to.be.null;
      expect(thingy).to.be.an.instanceof(Client);
      expect(self.getSpy).to.have.been.calledWith(sinon.match({
        data: {authorizationFingerprint: fingerprint}
      }));
      done();
    });
  });

  it('gets the configuration from the gateway', function (done) {
    var self = this;

    client.create({authorization: fake.tokenizationKey}, function () {
      expect(self.getSpy).to.have.been.calledWith(sinon.match({
        url: sinon.match(/client_api\/v1\/configuration$/)
      }));
      done();
    });
  });

  it('errors out when configuration endpoint is not reachable', function (done) {
    this.getSpy.restore();
    this.getSpy = this.sandbox.stub(AJAXDriver, 'request', function (options, cb) {
      cb({errors: 'Unknown error'});
    });

    client.create({authorization: fake.tokenizationKey}, function (err, thingy) {
      expect(err).to.be.an.instanceOf(BraintreeError);
      expect(err.type).to.equal('NETWORK');
      expect(err.message).to.equal('Cannot contact the gateway at this time.');
      expect(thingy).not.to.exist;
      done();
    });
  });

  it('errors out when the Client fails to initialize', function (done) {
    this.getSpy.restore();
    this.getSpy = this.sandbox.stub(AJAXDriver, 'request', function (options, cb) {
      cb(null, null);
    });

    client.create({authorization: fake.tokenizationKey}, function (err, thingy) {
      expect(err).to.be.an.instanceOf(BraintreeError);
      expect(err.type).to.equal('INTERNAL');
      expect(err.message).to.equal('Missing gatewayConfiguration.');
      expect(thingy).not.to.exist;
      done();
    });
  });
});