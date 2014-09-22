var Promise = require('bluebird');
var CircularJSON = require('circular-json');
var crypto = require('crypto');
var redis = null;
var sequelize = null;

module.exports = init;

/**
 * Initializer to return the cacher constructor
 */
function init(seq, red) {
  sequelize = seq;
  redis = red;
  return Cacher;
}

/**
 * Constructor for cacher
 */
function Cacher(model) {
  if (!(this instanceof Cacher)) {
    return new Cacher(model);
  }
  this.method = 'find';
  this.modelName = model;
  this.model = sequelize.model(model);
  this.options = null;
  this.queryOptions = null;
  this.seconds = 0;
  this.cacheHit = false;
  this.cachePrefix = 'cacher';
}

/**
 * Set cache prefix
 */
Cacher.prototype.prefix = function prefix(cachePrefix) {
  this.cachePrefix = cachePrefix;
  return this;
};

/**
 * Execute the query and return a promise
 */
Cacher.prototype.query = function query(options, queryOptions) {
  this.options = options;
  this.queryOptions = queryOptions;
  var key = this.key();
  return this.fetchFromCache();
};

/**
 * Set redis TTL (in seconds)
 */
Cacher.prototype.ttl = function ttl(seconds) {
  this.seconds = seconds;
  return this;
};

/**
 * Fetch from the database
 */
Cacher.prototype.fetchFromDatabase = function fetchFromDatabase(key) {
  var method = this.model[this.method];
  var self = this;
  return new Promise(function promiser(resolve, reject) {
    if (!method) {
      return reject(new Error('Invalid method - ' + self.method));
    }
    return method.call(self.model, self.options, self.queryOptions)
      .then(function then(results) {
        return self.setCache(key, results, self.seconds)
          .then(
            function good() {
              return resolve(results);
            },
            function bad(err) {
              return reject(err);
            }
          );
      });
  });
};

/**
 * Set data in cache
 */
Cacher.prototype.setCache = function setCache(key, results, ttl) {
  return new Promise(function promiser(resolve, reject) {
    var res;
    try {
      res = JSON.stringify(results);
    } catch (e) {
      return reject(e);
    }
    return redis.setex(key, ttl, res, function(err, res) {
      if (err) {
        return reject(err);
      }
      return resolve(res);
    });
  });
};

/**
 * Clear cache with given query
 */
Cacher.prototype.clearCache = function clearCache(opts) {
  var self = this;
  this.options = opts || this.options;
  return new Promise(function promiser(resolve, reject) {
    var key = self.key();
    return redis.del(key, function onDel(err) {
      if (err) {
        return reject(err);
      }
      return resolve();
    });
  });
};

/**
 * Fetch data from cache
 */
Cacher.prototype.fetchFromCache = function fetchFromCache() {
  var self = this;
  return new Promise(function promiser(resolve, reject) {
    var key = self.key();
    return redis.get(key, function(err, res) {
      if (err) {
        return reject(err);
      }
      if (!res) {
        return self.fetchFromDatabase(key).then(resolve, reject);
      }
      self.cacheHit = true;
      try {
        return resolve(JSON.parse(res));
      } catch (e) {
        return reject(e);
      }
    });
  });
};

/**
 * Create redis key
 */
Cacher.prototype.key = function key() {
  var hash = crypto.createHash('sha1')
    .update(CircularJSON.stringify(this.options))
    .digest('hex');
  return [this.cachePrefix, this.modelName, this.method, hash].join(':');
};

/**
 * Add a retrieval method
 */
function addMethod(key) {
  Cacher.prototype[key] = function() {
    this.method = key;
    return this.query.apply(this, arguments);
  };
}

var methods = [
  'find',
  'findAll',
  'findAndCountAll',
  'all',
  'min',
  'max',
  'sum'
];

methods.forEach(addMethod);