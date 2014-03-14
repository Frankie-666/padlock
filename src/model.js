/**
 * Module containing logic for records, collections and the data store.
 */
define(["padlock/crypto", "padlock/util"], function(crypto, util) {
    /**
     * The _Source_ object is responsible for fetching/saving data from/to a persistent
     * storage like localStorage or a cloud. It is meant as a base object to be extended
     * by different implementations
     */
    var Source = function() {
    };

    Source.prototype = {
        didFetch: function(rawData, opts) {
            try {
                // Try to parse data
                var data = JSON.parse(rawData);
                if (opts && opts.success) {
                    opts.success(data);
                }
            } catch (e) {
                if (opts && opts.fail) {
                    opts.fail(e);
                }
            }
        },
        /**
         * Fetches data
         * @param Object opts
         * Object containing options for the call. Options may include:
         *
         * - collName (required): Name of the collection to fetch data for
         * - success: Success callback. Retrieved data will be passed as only argument
         * - fail: Fail callback
         */
        fetch: function(opts) {
            // Not implemented
        },
        /**
         * Saves data
         * @param Object opts
         * Object containing options for the call. Options may include:
         *
         * - collName (required): Name of the collection to save data for
         * - success: Success callback.
         */
        save: function(opts) {
            // Not implemented
        },
        /**
         * Checks if data for a collection exists.
         * Object containing options for the call. Options may include:
         *
         * - collName (required): Name of the collection to check for
         * - success: Success callback. Will be passed _true_ or _false_ as the
         *            only argument, depending on the outcome
         */
        collectionExists: function(opts) {
            // Not implemented
        }
    };

    /**
     * This source uses the _localStorage_ api to fetch and store data. Although
     * _localStorage_ works synchronously, All methods use callbacks to be
     * consistent with asynchronous sources.
     */
    var LocalStorageSource = function() {};
    LocalStorageSource.prototype = Object.create(Source.prototype);
    LocalStorageSource.prototype.constructor = LocalStorageSource;

    LocalStorageSource.prototype.fetch = function(opts) {
        var json = localStorage.getItem("coll_" + opts.collName);
        this.didFetch(json, opts);
    };

    LocalStorageSource.prototype.save = function(opts) {
        localStorage.setItem("coll_" + opts.collName, JSON.stringify(opts.data));
        if (opts.success) {
            opts.success();
        }
    };

    LocalStorageSource.prototype.collectionExists = function(opts) {
        var exists = localStorage.getItem("coll_" + opts.collName) !== null;
        if (opts.success) {
            opts.success(exists);
        }
    };

    /**
     * This source uses the Padlock cloud api to fetch and store data.
     */
    CloudSource = function(host, email) {
        this.host = host;
        this.email = email;
    };
    CloudSource.prototype = Object.create(Source.prototype);
    CloudSource.prototype.constructor = CloudSource;

    CloudSource.prototype.fetch = function(opts) {
        var req = new XMLHttpRequest(),
            url = this.host + "/" + this.email;

        req.onreadystatechange = function() {
            if (req.readyState === 4) {
                if (req.status === 200) {
                    this.didFetch(req.responseText, opts);
                } else if (opts && opts.fail) {
                    opts.fail(req.status, req.responseText);
                }
            }
        }.bind(this);

        req.open("GET", url, true);
        req.send();
    };

    CloudSource.prototype.save = function(opts) {
        var req = new XMLHttpRequest(),
            url = this.host + "/" + this.email;

        req.onreadystatechange = function() {
            if (req.readyState === 4) {
                if (req.status === 200) {
                    if (opts.success) {
                        opts.success();
                    }
                } else if (opts.fail) {
                    opts.fail(req.status, req.responseText);
                }
            }
        };

        req.open("POST", url, true);
        req.send(JSON.stringify(opts.data));
    };

    CloudSource.prototype.collectionExists = function(opts) {
        var success = opts.success,
            fail = opts.fail;

        opts.success = function() {
            success(true);
        };
        opts.fail = function(status) {
            if (status == 404) {
                success(false);
            } else if (fail) {
                fail();
            }
        };
        this.fetch(opts);
    };

    /**
     * The _Store_ acts as a proxy between the persistence layer (e.g. _LocalStorageSource_)
     * and a _Collection_ object it mainly handles encryption and decryption of data
     * @param Object defaultSource Default source to be used for _fetch_, _save_ etc.
     */
    var Store = function(defaultSource) {
        this.defaultSource = defaultSource || new LocalStorageSource();
        this.password = "";
    };

    Store.prototype = {
        /**
         * Fetches the data for an array from local storage, decrypts it and populates the collection
         * @param  {Collection} coll     The collection to fetch the data for
         * @param  {Object}     opts     Object containing options for this call. Options may include:
         * 
         * - password: Password to be used for decryption. If not provided,
         *                        the stores own _password_ property will be used
         * - success:  Success callback
         * - fail:     Fail callback
         * - source:   Source to use for retreiving the data. If not provided, _defaultSource_ is used. 
         */
        fetch: function(coll, opts) {
            opts = opts || {};
            source = opts.source || this.defaultSource;
            // Use password argument if provided, otherwise use _this.password_
            var password = opts.password !== undefined && opts.password !== null ? opts.password : this.password;
            var obj = {};

            source.fetch({collName: coll.name, success: function(data) {
                try {
                    // Try to decrypt and parse data
                    coll.records = JSON.parse(crypto.pwdDecrypt(password, data));
                    if (opts.success) {
                        opts.success(coll);
                    }
                } catch (e) {
                    if (opts.fail) {
                        opts.fail(e);
                    }
                }
            }, fail: opts.fail});

            // Remember the password for next time we save or fetch data
            this.password = password;
        },
        /**
         * Encrypts the contents of a collection and saves them to local storage.
         * @param  {Collection} coll Collection to save
         * @param  {Object}     opts Object containing options for the call. Options may include:
         *
         * - success:  Success callback
         * - fail:     Fail callback
         * - source:   Source to store the data to. If not provided, _defaultSource_ is used. 
         */
        save: function(coll, opts) {
            opts = opts || {};
            source = opts.source || this.defaultSource;
            // Stringify the collections record array
            var pt = JSON.stringify(coll.records);
            // Encrypt the JSON string
            var c = crypto.pwdEncrypt(this.password, pt);
            opts.collName = coll.name;
            opts.data = c;
            source.save(opts);
        },
        /**
         * Checks whether or not data for a collection exists in localstorage
         * @param  {Collection} coll Collection to check for
         * @param  {Object}     opts Object containing options for the call. Options may include:
         *
         * - success:  Success callback. Will be passed _true_ or _false_ as only argument,
         *             depending on the outcome.
         * - fail:     Fail callback
         * - source:   Source to check for the collection. If not provided, _defaultSource_ is used. 
         */
        collectionExists: function(coll, opts) {
            source = opts.source || this.defaultSource;
            opts = opts || {};
            opts.collName = coll.name;
            source.collectionExists(opts);
        }
    };

    /**
     * A collection of records
     * @param {String} name    Name of the collection
     * @param {Store}  store   Store instance to be used. If not provided,
     *                         a new instance will be created.
     */
    var Collection = function(name, store) {
        this.name = name || "default";
        this.store = store || new Store();
        this.uuidMap = {};
    };

    Collection.prototype = {
        /**
         * Fetches the data for this collection
         * @param {Object} opts Object containing options for the call. Options may include:
         * 
         * - password: Password to be used for decyrption
         * - success:  Success callback. Will be passed the collection as only argument
         * - fail:     Fail callback
         * - source:   Source to to be used. If not provided, the stores default source is used.
         */
        fetch: function(opts) {
            this.store.fetch(this, opts);
        },
        /**
         * Saves the collections contents
         * @param {Object} opts Object containing options for the call. Options may include:
         * 
         * - success:  Success callback. Will be passed the collection as only argument
         * - fail:     Fail callback
         * - source:   Source to to be used. If not provided, the stores default source is used.
         */
        save: function(opts) {
            var rec = opts && opts.record;
            if (rec) {
                rec.name = rec.name || "Unnamed";
                // Filter out fields that have neither a name nor a value
                rec.fields = rec.fields.filter(function(field) {
                    return field.name || field.value;
                });
                rec.updated = new Date();
            }
            this.store.save(this, opts);
        },
        /**
         * Adds a record or an array of records to the collection
         * @param {Object}  rec A record object or an array of record objects to be added to the collection
         */
        add: function(rec, at) {
            var records = this.records.slice();

            rec = util.isArray(rec) ? rec : [rec];
            rec.forEach(function(r) {
                r.uuid = r.uuid || util.uuid();
                var existing = this.uuidMap[r.uuid];
                if (existing && r.updated && r.updated > existing.updated) {
                    records[records.indexOf(existing)] = r;
                } else {
                    this.uuidMap[r.uuid] = r;
                    records.push(r);
                }
            }.bind(this));

            this.records = records;
        },
        /**
         * Removes a record from this collection
         * @param  {Object} rec The record object to be removed
         */
        remove: function(rec) {
            delete rec.name;
            delete rec.category;
            delete rec.fields;
            rec.updated = new Date();
            rec.deleted = true;
        },
        /**
         * Sets the new password for this collections store and saves the collection
         * @param {String} password New password
         */
        setPassword: function(password) {
            this.store.password = password;
            this.save();
        },
        /**
         * Checks whether or not data for the collection exists
         * @param  {Object}     opts Object containing options for the call. Options may include:
         *
         * - success:  Success callback. Will be passed _true_ or _false_ as only argument,
         *             depending on the outcome.
         * - fail:     Fail callback
         * - source:   Source to check for the collection. If not provided, _defaultSource_ is used. 
         */
        exists: function(opts) {
            this.store.collectionExists(this, opts);
        },
        /**
         * Empties the collection and removes the stored password
         */
        lock: function() {
            this.records = [];
            this.store.password = null;
        }
    };

    /**
     * Manager object for a categories. Each category has a name
     * and a color, which is encoded as a number between 1 and _numColor_
     *
     * @param {String}  name The name, used for persistent storage
     * @param {Integer} numColor [description]
     */
    var Categories = function(name, numColors) {
        this.name = name || "default";
        this.categories = {};
        this.numColors = numColors || 0;
    };

    //* Sets the _color_ for a _category_. Adds the category if it doesn't exist yet.
    Categories.prototype.set = function(category, color) {
        this.categories[category] = color;
    };

    //* Returns the color for a _category_ or _undefined_ if the category does not exist
    Categories.prototype.get = function(category) {
        return this.categories[category];
    };

    //* Removes a _category_ from the existing set of categories.
    Categories.prototype.remove = function(category) {
        delete this.categories[category];
    };

    //* Fetches stored categories from local storage 
    Categories.prototype.fetch = function() {
        var fetched = JSON.parse(localStorage.getItem("cat_" + this.name) || "{}");
        // Merge in categories into _this.categories_ object. This will _not_
        // overwrite categories already added.
        this.categories = util.mixin(this.categories, fetched);
    };

    //* Saves categories to local storage
    Categories.prototype.save = function() {
        localStorage.setItem("cat_" + this.name, JSON.stringify(this.categories));
    };

    //* Returns the preferable color for a new category
    Categories.prototype.autoColor = function() {
        // TODO: Check current distribution and return color which is currently
        // being used the least
        return Math.ceil(Math.random() * this.numColors);
    };

    //* Returns an Array represantation of the categories set.
    Categories.prototype.asArray = function() {
        var arr = [];

        for (var cat in this.categories) {
            arr.push({
                name: cat,
                color: this.categories[cat]
            });
        }

        return arr;
    };

    return {
        Store: Store,
        Collection: Collection,
        Categories: Categories,
        LocalStorageSource: LocalStorageSource,
        CloudSource: CloudSource
    };
});