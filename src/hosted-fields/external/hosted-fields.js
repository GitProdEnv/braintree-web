'use strict';

var Destructor = require('../../lib/destructor');
var classlist = require('../../lib/classlist');
var iFramer = require('iframer');
var Bus = require('../../lib/bus');
var BraintreeError = require('../../lib/error');
var composeUrl = require('./compose-url');
var constants = require('../shared/constants');
var INTEGRATION_TIMEOUT_MS = require('../../lib/constants').INTEGRATION_TIMEOUT_MS;
var uuid = require('../../lib/uuid');
var findParentTags = require('../shared/find-parent-tags');
var isIos = require('../../lib/is-ios');
var events = constants.events;
var EventEmitter = require('../../lib/event-emitter');
var injectFrame = require('./inject-frame');
var analytics = require('../../lib/analytics');
var whitelistedFields = constants.whitelistedFields;
var VERSION = require('package.version');
var methods = require('../../lib/methods');
var convertMethodsToError = require('../../lib/convert-methods-to-error');
var deferred = require('../../lib/deferred');

/**
 * @typedef {object} HostedFields~tokenizePayload
 * @property {string} nonce The payment method nonce.
 * @property {object} details Additional account details.
 * @property {string} details.cardType Type of card, ex: Visa, MasterCard.
 * @property {string} details.lastTwo Last two digits of card number.
 * @property {string} description A human-readable description.
 */

/**
 * @typedef {object} HostedFields~hostedFieldsEventFieldData
 * @description Data about Hosted Fields fields, sent in {@link HostedFields~hostedFieldsEvent|hostedFieldEvent} objects.
 * @property {HTMLElement} container Reference to the container DOM element on your page associated with the current event.
 * @property {boolean} isFocused Whether or not the input is currently focused.
 * @property {boolean} isEmpty Whether or not the user has entered a value in the input.
 * @property {boolean} isPotentiallyValid
 * A determination based on the future validity of the input value.
 * This is helpful when a user is entering a card number and types <code>"41"</code>.
 * While that value is not valid for submission, it is still possible for
 * it to become a fully qualified entry. However, if the user enters <code>"4x"</code>
 * it is clear that the card number can never become valid and isPotentiallyValid will
 * return false.
 * @property {boolean} isValid Whether or not the value of the associated input is <i>fully</i> qualified for submission.
 */

/**
 * @typedef {object} HostedFields~hostedFieldsEventCard
 * @description Information about the card type, sent in {@link HostedFields~hostedFieldsEvent|hostedFieldEvent} objects.
 * @property {string} type The code-friendly representation of the card type. It will be one of the following strings:
 * - `american-express`
 * - `diners-club`
 * - `discover`
 * - `jcb`
 * - `maestro`
 * - `master-card`
 * - `unionpay`
 * - `visa`
 * @property {string} niceType The pretty-printed card type. It will be one of the following strings:
 * - `American Express`
 * - `Diners Club`
 * - `Discover`
 * - `JCB`
 * - `Maestro`
 * - `MasterCard`
 * - `UnionPay`
 * - `Visa`
 * @property {object} code
 * This object contains data relevant to the security code requirements of the card brand.
 * For example, on a Visa card there will be a <code>CVV</code> of 3 digits, whereas an
 * American Express card requires a 4-digit <code>CID</code>.
 * @property {string} code.name <code>"CVV"</code> <code>"CID"</code> <code>"CVC"</code>
 * @property {number} code.size The expected length of the security code. Typically, this is 3 or 4.
 */

/**
 * @typedef {object} HostedFields~hostedFieldsEvent
 * @description The event payload sent from {@link HostedFields#on|on}.
 * @property {string} emittedBy
 * The name of the field associated with this event. It will be one of the following strings:<br>
 * - `"number"`
 * - `"cvv"`
 * - `"expirationDate"`
 * - `"expirationMonth"`
 * - `"expirationYear"`
 * - `"postalCode"`
 * @property {object} fields
 * @property {?HostedFields~hostedFieldsEventFieldData} fields.number {@link HostedFields~hostedFieldsEventFieldData|hostedFieldsEventFieldData} for the number field, if it is present.
 * @property {?HostedFields~hostedFieldsEventFieldData} fields.cvv {@link HostedFields~hostedFieldsEventFieldData|hostedFieldsEventFieldData} for the CVV field, if it is present.
 * @property {?HostedFields~hostedFieldsEventFieldData} fields.expirationDate {@link HostedFields~hostedFieldsEventFieldData|hostedFieldsEventFieldData} for the expiration date field, if it is present.
 * @property {?HostedFields~hostedFieldsEventFieldData} fields.expirationMonth {@link HostedFields~hostedFieldsEventFieldData|hostedFieldsEventFieldData} for the expiration month field, if it is present.
 * @property {?HostedFields~hostedFieldsEventFieldData} fields.expirationYear {@link HostedFields~hostedFieldsEventFieldData|hostedFieldsEventFieldData} for the expiration year field, if it is present.
 * @property {?HostedFields~hostedFieldsEventFieldData} fields.postalCode {@link HostedFields~hostedFieldsEventFieldData|hostedFieldsEventFieldData} for the postal code field, if it is present.
 * @property {HostedFields~hostedFieldsEventCard[]} cards
 * This will return an array of potential {@link HostedFields~hostedFieldsEventFieldCard|cards}. If the card type has been determined, the array will contain only one card.
 * Internally, Hosted Fields uses <a href="https://github.com/braintree/credit-card-type">credit-card-type</a>,
 * an open-source card detection library.
 */

/**
 * @name HostedFields#on
 * @function
 * @param {string} event The name of the event to which you are subscribing.
 * @param {function} handler A callback to handle the event.
 * @description Subscribes a handler function to a named {@link HostedFields~hostedFieldsEvent|hostedFieldsEvent}. `event` should be {@link HostedFields#event:blur|blur}, {@link HostedFields#event:focus|focus}, {@link HostedFields#event:empty|empty}, {@link HostedFields#event:notEmpty|notEmpty}, {@link HostedFields#event:cardTypeChange|cardTypeChange}, or {@link HostedFields#event:validityChange|validityChange}.
 * @example
 * <caption>Listening to a Hosted Field event, in this case 'focus'</caption>
 * hostedFields.create({ ... }, function (createErr, hostedFieldsInstance) {
 *   hostedFieldsInstance.on('focus', function (event) {
 *     console.log(event.emittedBy, 'has been focused');
 *   });
 * });
 * @returns {void}
 */

/**
 * This {@link HostedFields~hostedFieldsEvent|hostedFieldsEvent} is emitted when the user requests submission of an input field, such as by pressing the Enter or Return key on their keyboard, or mobile equivalent.
 * @event HostedFields#inputSubmitRequest
 * @type {HostedFields~hostedFieldsEvent}
 * @example
 * <caption>Clicking a submit button upon hitting Enter (or equivalent) within a Hosted Field</caption>
 * var hostedFields = require('braintree-web/hosted-fields');
 * var submitButton = document.querySelector('input[type="submit"]');
 *
 * hostedFields.create({ ... }, function (createErr, hostedFieldsInstance) {
 *   hostedFieldsInstance.on('inputSubmitRequest', function () {
 *     // User requested submission, e.g. by pressing Enter or equivalent
 *     submitButton.click();
 *   });
 * });
 */

/**
 * This {@link HostedFields~hostedFieldsEvent|hostedFieldsEvent} is emitted when a field transitions from having data to being empty.
 * @event HostedFields#empty
 * @type {HostedFields~hostedFieldsEvent}
 * @example
 * <caption>Listening to an empty event</caption>
 * hostedFields.create({ ... }, function (createErr, hostedFieldsInstance) {
 *   hostedFieldsInstance.on('empty', function (event) {
 *     console.log(event.emittedBy, 'is now empty');
 *   });
 * });
 */

/**
 * This {@link HostedFields~hostedFieldsEvent|hostedFieldsEvent} is emitted when a field transitions from being empty to having data.
 * @event HostedFields#notEmpty
 * @type {HostedFields~hostedFieldsEvent}
 * @example
 * <caption>Listening to an notEmpty event</caption>
 * hostedFields.create({ ... }, function (createErr, hostedFieldsInstance) {
 *   hostedFieldsInstance.on('notEmpty', function (event) {
 *     console.log(event.emittedBy, 'is now not empty');
 *   });
 * });
 */

/**
 * This {@link HostedFields~hostedFieldsEvent|hostedFieldsEvent} is emitted when a field loses focus.
 * @event HostedFields#blur
 * @type {HostedFields~hostedFieldsEvent}
 * @example
 * <caption>Listening to a blur event</caption>
 * hostedFields.create({ ... }, function (createErr, hostedFieldsInstance) {
 *   hostedFieldsInstance.on('blur', function (event) {
 *     console.log(event.emittedBy, 'lost focus');
 *   });
 * });
 */

/**
 * This {@link HostedFields~hostedFieldsEvent|hostedFieldsEvent} is emitted when a field gains focus.
 * @event HostedFields#focus
 * @type {HostedFields~hostedFieldsEvent}
 * @example
 * <caption>Listening to a focus event</caption>
 * hostedFields.create({ ... }, function (createErr, hostedFieldsInstance) {
 *   hostedFieldsInstance.on('focus', function (event) {
 *     console.log(event.emittedBy, 'gained focus');
 *   });
 * });
 */

/**
 * This {@link HostedFields~hostedFieldsEvent|hostedFieldsEvent} is emitted when activity within the number field has changed such that the possible card type has changed.
 * @event HostedFields#cardTypeChange
 * @type {HostedFields~hostedFieldsEvent}
 * @example
 * <caption>Listening to a cardTypeChange event</caption>
 * hostedFields.create({ ... }, function (createErr, hostedFieldsInstance) {
 *   hosteFieldsInstance.on('cardTypeChange', function (event) {
 *     if (event.cards.length === 1) {
 *       console.log(event.cards[0].type);
 *     } else {
 *       console.log('Type of card not yet known');
 *     }
 *   });
 * });
 */

/**
 * This {@link HostedFields~hostedFieldsEvent|hostedFieldsEvent} is emitted when the validity of a field has changed. Validity is represented in the {@link HostedFields~hostedFieldsEvent|hostedFieldsEvent} as two booleans: `isValid` and `isPotentiallyValid`.
 * @event HostedFields#validityChange
 * @type {HostedFields~hostedFieldsEvent}
 * @example
 * <caption>Listening to a validityChange event</caption>
 * hostedFields.create({ ... }, function (createErr, hostedFieldsInstance) {
 *   hostedFieldsInstance.on('validityChange', function (event) {
 *     var field = event.fields[event.emittedBy];
 *
 *     if (field.isValid) {
 *       console.log(event.emittedBy, 'is fully valid');
 *     } else if (field.isPotentiallyValid) {
 *       console.log(event.emittedBy, 'is potentially valid');
 *     } else {
 *       console.log(event.emittedBy, 'is not valid');
 *     }
 *   });
 * });
 */

function inputEventHandler(fields) {
  return function (eventData) {
    var field;
    var merchantPayload = eventData.merchantPayload;
    var emittedBy = merchantPayload.emittedBy;
    var container = fields[emittedBy].containerElement;

    Object.keys(merchantPayload.fields).forEach(function (key) {
      merchantPayload.fields[key].container = fields[key].containerElement;
    });

    field = merchantPayload.fields[emittedBy];

    classlist.toggle(container, constants.externalClasses.FOCUSED, field.isFocused);
    classlist.toggle(container, constants.externalClasses.VALID, field.isValid);

    if (field.isStrictlyValidating) {
      classlist.toggle(container, constants.externalClasses.INVALID, !field.isValid);
    } else {
      classlist.toggle(container, constants.externalClasses.INVALID, !field.isPotentiallyValid);
    }

    this._emit(eventData.type, merchantPayload); // eslint-disable-line no-invalid-this
  };
}

/**
 * @class HostedFields
 * @param {object} options The Hosted Fields {@link module:braintree-web/hosted-fields.create create} options.
 * @description <strong>Do not use this constructor directly. Use {@link module:braintree-web/hosted-fields.create|braintree-web.hosted-fields.create} instead.</strong>
 * @classdesc This class represents a Hosted Fields component produced by {@link module:braintree-web/hosted-fields.create|braintree-web/hosted-fields.create}. Instances of this class have methods for interacting with the input fields within Hosted Fields' iframes.
 */
function HostedFields(options) {
  var field, container, frame, key, failureTimeout, clientVersion;
  var self = this;
  var fields = {};
  var fieldCount = 0;
  var componentId = uuid();

  if (!options.client) {
    throw new BraintreeError({
      type: BraintreeError.types.MERCHANT,
      message: 'You must specify a client when initializing Hosted Fields.'
    });
  }

  clientVersion = options.client.getConfiguration().analyticsMetadata.sdkVersion;
  if (clientVersion !== VERSION) {
    throw new BraintreeError({
      type: BraintreeError.types.MERCHANT,
      message: 'Client (version ' + clientVersion + ') and Hosted Fields (version ' + VERSION + ') components must be from the same SDK version.'
    });
  }

  if (!options.fields) {
    throw new BraintreeError({
      type: BraintreeError.types.MERCHANT,
      message: 'You must specify fields when initializing Hosted Fields.'
    });
  }

  EventEmitter.call(this);

  this._injectedNodes = [];
  this._destructor = new Destructor();
  this._fields = fields;

  this._bus = new Bus({
    channel: componentId,
    merchantUrl: location.href
  });

  this._destructor.registerFunctionForTeardown(function () {
    self._bus.teardown();
  });

  this._client = options.client;

  analytics.sendEvent(this._client, 'web.custom.hosted-fields.initialized');

  for (key in constants.whitelistedFields) {
    if (constants.whitelistedFields.hasOwnProperty(key)) {
      field = options.fields[key];

      if (!field) { continue; }

      container = document.querySelector(field.selector);

      if (!container) {
        throw new BraintreeError({
          type: BraintreeError.types.MERCHANT,
          message: 'Selector does not reference a valid DOM node.',
          details: {
            fieldSelector: field.selector,
            fieldKey: key
          }
        });
      } else if (container.querySelector('iframe[name^="braintree-"]')) {
        throw new BraintreeError({
          type: BraintreeError.types.MERCHANT,
          message: 'Element already contains a Braintree iframe.',
          details: {
            fieldSelector: field.selector,
            fieldKey: key
          }
        });
      }

      frame = iFramer({
        type: key,
        name: 'braintree-hosted-field-' + key,
        style: constants.defaultIFrameStyle
      });

      this._injectedNodes = this._injectedNodes.concat(injectFrame(frame, container));
      this._setupLabelFocus(key, container);
      fields[key] = {
        frameElement: frame,
        containerElement: container
      };
      fieldCount++;

      /* eslint-disable no-loop-func */
      setTimeout((function (f) {
        return function () {
          f.src = composeUrl(
            self._client.getConfiguration().gatewayConfiguration.assetsUrl,
            componentId
          );
        };
      })(frame), 0);
    }
  } /* eslint-enable no-loop-func */

  failureTimeout = setTimeout(function () {
    analytics.sendEvent(self._client, 'web.custom.hosted-fields.load.timed-out');
  }, INTEGRATION_TIMEOUT_MS);

  this._bus.on(events.FRAME_READY, function (reply) {
    fieldCount--;
    if (fieldCount === 0) {
      clearTimeout(failureTimeout);
      reply(options);
      self._emit('ready');
    }
  });

  this._bus.on(
    events.INPUT_EVENT,
    inputEventHandler(fields).bind(this)
  );

  this._destructor.registerFunctionForTeardown(function () {
    var j, node, parent;

    for (j = 0; j < self._injectedNodes.length; j++) {
      node = self._injectedNodes[j];
      parent = node.parentNode;

      parent.removeChild(node);

      classlist.remove(
        parent,
        constants.externalClasses.FOCUSED,
        constants.externalClasses.INVALID,
        constants.externalClasses.VALID
      );
    }
  });

  this._destructor.registerFunctionForTeardown(function () {
    var methodNames = methods(HostedFields.prototype).concat(methods(EventEmitter.prototype));

    convertMethodsToError(self, methodNames);
  });
}

HostedFields.prototype = Object.create(EventEmitter.prototype, {
  constructor: HostedFields
});

HostedFields.prototype._setupLabelFocus = function (type, container) {
  var labels, i;
  var shouldSkipLabelFocus = isIos();
  var bus = this._bus;

  if (shouldSkipLabelFocus) { return; }
  if (container.id == null) { return; }

  function triggerFocus() {
    bus.emit(events.TRIGGER_INPUT_FOCUS, type);
  }

  labels = Array.prototype.slice.call(document.querySelectorAll('label[for="' + container.id + '"]'));
  labels = labels.concat(findParentTags(container, 'label'));

  for (i = 0; i < labels.length; i++) {
    labels[i].addEventListener('click', triggerFocus, false);
  }

  this._destructor.registerFunctionForTeardown(function () {
    for (i = 0; i < labels.length; i++) {
      labels[i].removeEventListener('click', triggerFocus, false);
    }
  });
};

/**
 * Cleanly tear down anything set up by {@link module:braintree-web/hosted-fields.create|create}
 * @public
 * @param {callback} [callback] Callback executed on completion, containing an error if one occurred. No data is returned if teardown completes successfully.
 * @example
 * hostedFieldsInstance.teardown(function (teardownErr) {
 *   if (teardownErr) {
 *     console.error('Could not tear down Hosted Fields!');
 *   } else {
 *     console.info('Hosted Fields has been torn down!');
 *   }
 * });
 * @returns {void}
 */
HostedFields.prototype.teardown = function (callback) {
  var client = this._client;

  this._destructor.teardown(function (err) {
    analytics.sendEvent(client, 'web.custom.hosted-fields.teardown-completed');

    if (typeof callback === 'function') {
      callback = deferred(callback);
      callback(err);
    }
  });
};

/**
 * Tokenizes fields and returns a nonce payload.
 * @public
 * @param {callback} callback The second argument, <code>data</code>, is a {@link HostedFields~tokenizePayload|tokenizePayload}
 * @example
 * hostedFieldsInstance.tokenize(function (tokenizeErr, payload) {
 *   if (tokenizeErr) {
 *     console.error(tokenizeErr);
 *   } else {
 *     console.log('Got nonce:', payload.nonce);
 *   }
 * });
 * @returns {void}
 */
HostedFields.prototype.tokenize = function (callback) {
  if (typeof callback !== 'function') {
    throw new BraintreeError({
      type: BraintreeError.types.MERCHANT,
      message: 'tokenize must include a callback function.'
    });
  }

  this._bus.emit(events.TOKENIZATION_REQUEST, function (response) {
    callback.apply(null, response);
  });
};

/**
 * Sets the placeholder of a {@link module:braintree-web/hosted-fields~field field}.
 * @public
 * @param {string} field The field whose placeholder you wish to change. Must be a valid {@link module:braintree-web/hosted-fields~fieldOptions fieldOption}.
 * @param {string} placeholder Will be used as the `placeholder` attribute of the input.
 * @param {callback} [callback] Callback executed on completion, containing an error if one occurred. No data is returned if the placeholder updated successfully.
 *
 * @example
 * hostedFieldsInstance.setPlaceholder('number', '4111 1111 1111 1111', function (placeholderErr) {
 *   if (placeholderErr) {
 *     console.error(placeholderErr);
 *   }
 * });
 *
 * @example <caption>Update CVV field on card type change</caption>
 * hostedFieldsInstance.on('cardTypeChange', function (event) {
 *   // Update the placeholder value if there is only one possible card type
 *   if (event.cards.length === 1) {
 *     hostedFields.setPlaceholder('cvv', event.cards[0].code.name, function (placeholderErr) {
 *       if (placeholderErr) {
 *         // Handle errors, such as invalid field name
 *         console.error(placeholderErr);
 *       }
 *     });
 *   }
 * });
 * @returns {void}
 */
HostedFields.prototype.setPlaceholder = function (field, placeholder, callback) {
  var err;

  if (!whitelistedFields.hasOwnProperty(field)) {
    err = new BraintreeError({
      type: BraintreeError.types.MERCHANT,
      message: '"' + field + '" is not a valid field. You must use a valid field option when setting a placeholder.'
    });
  } else if (!this._fields.hasOwnProperty(field)) {
    err = new BraintreeError({
      type: BraintreeError.types.MERCHANT,
      message: 'Cannot set placeholder for "' + field + '" field because it is not part of the current Hosted Fields options.'
    });
  } else {
    this._bus.emit(events.SET_PLACEHOLDER, field, placeholder);
  }

  if (typeof callback === 'function') {
    callback = deferred(callback);
    callback(err);
  }
};

/**
 * Clear the value of a {@link module:braintree-web/hosted-fields~field field}.
 * @public
 * @param {string} field The field whose placeholder you wish to clear. Must be a valid {@link module:braintree-web/hosted-fields~fieldOptions fieldOption}.
 * @param {callback} [callback] Callback executed on completion, containing an error if one occurred. No data is returned if the field cleared successfully.
 * @returns {void}
 * @example
 * hostedFieldsInstance.clear('number', function (clearErr) {
 *   if (clearErr) {
 *     console.error(clearErr);
 *   }
 * });
 *
 * @example <caption>Clear several fields</caption>
 * hostedFieldsInstance.clear('number');
 * hostedFieldsInstance.clear('cvv');
 * hostedFieldsInstance.clear('expirationDate');
 */
HostedFields.prototype.clear = function (field, callback) {
  var err;

  if (!whitelistedFields.hasOwnProperty(field)) {
    err = new BraintreeError({
      type: BraintreeError.types.MERCHANT,
      message: '"' + field + '" is not a valid field. You must use a valid field option when clearing a field.'
    });
  } else if (!this._fields.hasOwnProperty(field)) {
    err = new BraintreeError({
      type: BraintreeError.types.MERCHANT,
      message: 'Cannot clear "' + field + '" field because it is not part of the current Hosted Fields options.'
    });
  } else {
    this._bus.emit(events.CLEAR_FIELD, field);
  }

  if (typeof callback === 'function') {
    callback = deferred(callback);
    callback(err);
  }
};

module.exports = HostedFields;