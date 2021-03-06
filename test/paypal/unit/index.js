'use strict';

var basicComponentVerification = require('../../../src/lib/basic-component-verification');
var createDeferredClient = require('../../../src/lib/create-deferred-client');
var createAssetsUrl = require('../../../src/lib/create-assets-url');
var create = require('../../../src/paypal').create;
var isSupported = require('../../../src/paypal').isSupported;
var analytics = require('../../../src/lib/analytics');
var fake = require('../../helpers/fake');
var PayPal = require('../../../src/paypal/external/paypal');
var BraintreeError = require('../../../src/lib/braintree-error');
var Promise = require('../../../src/lib/promise');

describe('paypal', function () {
  afterEach(function () {
    delete global.popupBridge;
  });

  describe('create', function () {
    beforeEach(function () {
      this.configuration = fake.configuration();
      this.configuration.gatewayConfiguration.paypalEnabled = true;

      this.sandbox.stub(analytics, 'sendEvent');
      this.client = fake.client({
        configuration: this.configuration
      });
      this.sandbox.stub(basicComponentVerification, 'verify').resolves();
      this.sandbox.stub(createDeferredClient, 'create').resolves(this.client);
      this.sandbox.stub(createAssetsUrl, 'create').returns('https://example.com/assets');
    });

    it('returns a promise when no callback is provided', function () {
      var promise = create({client: this.client});

      expect(promise).to.be.an.instanceof(Promise);
    });

    it('verifies with basicComponentVerification', function (done) {
      var client = this.client;

      this.sandbox.stub(PayPal.prototype, '_initialize').resolves();

      create({
        client: client
      }, function () {
        expect(basicComponentVerification.verify).to.be.calledOnce;
        expect(basicComponentVerification.verify).to.be.calledWithMatch({
          name: 'PayPal',
          client: client
        });
        done();
      });
    });

    it('can create with an authorization instead of a client', function (done) {
      this.sandbox.stub(PayPal.prototype, '_initialize').resolves();

      create({
        authorization: fake.clientToken,
        debug: true
      }, function (err) {
        expect(err).not.to.exist;

        expect(createDeferredClient.create).to.be.calledOnce;
        expect(createDeferredClient.create).to.be.calledWith({
          authorization: fake.clientToken,
          client: this.sandbox.match.typeOf('undefined'),
          debug: true,
          assetsUrl: 'https://example.com/assets',
          name: 'PayPal'
        });

        expect(PayPal.prototype._initialize).to.be.calledOnce;

        done();
      }.bind(this));
    });

    it('errors out if paypal is not enabled for the merchant', function (done) {
      this.configuration.gatewayConfiguration.paypalEnabled = false;

      create({client: this.client}, function (err, thingy) {
        expect(err).to.be.an.instanceof(BraintreeError);
        expect(err.type).to.equal('MERCHANT');
        expect(err.code).to.equal('PAYPAL_NOT_ENABLED');
        expect(err.message).to.equal('PayPal is not enabled for this merchant.');
        expect(thingy).not.to.exist;
        done();
      });
    });

    it('sends an analytics event', function (done) {
      var client = this.client;

      this.sandbox.stub(PayPal.prototype, '_initialize').resolves();

      create({client: client}, function (err) {
        expect(err).not.to.exist;
        expect(analytics.sendEvent).to.be.calledWith(client, 'paypal.initialized');

        done();
      });
    });
  });

  describe('isSupported', function () {
    it('returns true', function () {
      expect(isSupported()).to.be.true;
    });
  });
});
