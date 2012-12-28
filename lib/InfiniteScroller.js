(function () {
    'use strict';

    var self = {
        elem: null,     //panel element (scroll window)
        inner: null,    //moving element (first child of the scroll window)
        itemTpl: null,  //template for scrolling item
        scroller: null, //ZyngaScroller instance

        options: {
            colWidth: null,         //width of an element
            numElems: null,         //number of total elements that exist at a given moment (visible + 2)
            innerOffsetNr: 1000,    //how much to offset the scroller container (determines the maximum scroll amount until a solution for resetting the scroll is found)
            speedMultiplier: 1,     //multiply the scroll speed
            debug: false,           //show log of stuff in the console
            callbacks: {
                createElement: undefined,   //virtual element has been created
                destroyElement: undefined,  //virtual element has been destroyed
                becameVisible: undefined,   //virtual element became visible (its first edge is visible)
                becameInvisible: undefined, //virtual element became invisible (no part of it is visible anymore)
                started: undefined,         //scroller started moving
                stopped: undefined          //scroller stopped moving
            }
        },

        state: {
            direction: undefined,       //move direction (-1 => moving to the left, 1 => right)
            masterDirection: undefined, //direction of entry in the current element (values same as above)
            swappedDirection: 0,        //direction of the last swap (values same as above - 0 => no swap was made)
            currentIndex: 0,            //virtual index of current element (element with left edge out of the window)
            progress: 0,                //progress in the current element (depending on direction of movement)
            position: 0                 //normalized position of the container
        },

        lastState: {},

        started: false,             //flag whether the scroller is active or not
        passedEdgeLastTime: false,  //true if at the last iteration an edge has been passed
        swappedAlongWithEdge: false,//true if last time swap and edge were executed
        offsetValue: null,          //the px offset calculated based on innerOffsetNr
        swapOffset: 0,              //offset caused by removing the element at the beginning
        onEdgeTimeout: null,        //timeout set at every edge pass (stop detection)
        ignore: false,              //ignore reported movement for some time (used while initializing ZyngaScroller)
        attachedEvents: {},         //events hash registered by the scroller
        lastIndex: null,

        //executed once when the scroller is initialized
        init: function () {
            //container for the elements
            this.inner = this.elem.children[0];
            this.itemTpl = this.inner.children[0];

            //setup last state
            this.lastState.position = 0;
            this.lastState.currentIndex = 0;
            this.lastIndex = 0;

            //create scrollable items
            this.updateItems();

            //zynga scroller init
            this.initScroller();

            this.callbacks.publishCurrentState();

            return this;
        },

        updateItems: function () {
            var currentCount = this.inner.childElementCount,
                newCount = this.options.numElems,
                i;

            if (newCount !== currentCount) {
                if (newCount > currentCount) {
                    for (i = currentCount;i < newCount;i += 1) {
                        this.inner.appendChild(this.itemTpl.cloneNode(true));
                    }
                } else {
                    for (i = currentCount;i > newCount;i -= 1) {
                        this.inner.removeChild(this.inner.children[this.inner.childElementCount - 1]);
                    }
                }
            }
        },

        initScroller: function () {
            var getStyleIntValue;

            this.scroller = new Scroller(function (left) {
                self.update.call(self, self.getPositionFromScrollerValue(left), false);
            }, {
                scrollingX: true,
                scrollingY: false,
                snapping: true,
                bouncing: false,
                speedMultiplier: this.options.speedMultiplier
            });

            //calculate offset from the actual (HUGE) position
            if (!this.offsetValue) {
                this.offsetValue = this.options.colWidth * this.options.innerOffsetNr / 2;
            }

            this.setPosition(0);

            //get css property
            getStyleIntValue = function (elem, property) {
                return parseInt(window.getComputedStyle(elem, null).getPropertyValue(property), 10);
            };

            //setup zynga scroller
            this.ignore = true;
            this.scroller.setDimensions(getStyleIntValue(this.elem, 'width'), getStyleIntValue(this.elem, 'height'), this.options.innerOffsetNr * this.options.colWidth, getStyleIntValue(this.inner, 'height'));
            this.scroller.setSnapSize(this.options.colWidth, 0);
            this.scroller.scrollTo(this.offsetValue, 0, false, 1);
            this.ignore = false;

            //attach events for touch
            this.detachEvents();
            this.attachEvents();
        },

        update: function (position, supressPassDetection) {
            var state = this.state,
                lastState = this.lastState,
                tmpState = {};

            if (!this.ignore && position !== lastState.position) {
                this.updateState(position);

                if (this.passedMultipleKeypoints() && !supressPassDetection) {
                    this.log('target state: ', state);
                    this.copyObject(state, tmpState);
                    this.executeKeyPointsInSequence();
                    this.copyObject(tmpState, lastState);
                    return;
                } else if (this.passedEdge() || this.onEdge()) {
                    this.indexChange(state.currentIndex);
                } else if (this.swappable()) {
                    this.doSwap(state.currentIndex);
                }

                if (this.started === false) {
                    this.started = true;
                    this.callbacks.started();
                }

                if (this.onEdgeTimeout) {
                    clearTimeout(this.onEdgeTimeout);
                }

                this.onEdgeTimeout = setTimeout(function () {
                    self.stopped.call(self);
                }, 200);

                this.setPosition(position);
                this.copyObject(state, lastState);

                //log state
                this.log(state, 'x: ' + position);
            }
        },

        updateState: function (position) {
            var state = this.state,
                lastState = this.lastState,
                width = this.options.colWidth;

            state.position          = position;
            state.direction         = position < lastState.position ? -1 : 1;
            state.currentIndex      = -Math.ceil(position / width);
            state.masterDirection   = this.detectMasterDirection();
            state.progress          = this.calculateProgress();
        },

        indexChange: function (index) {
            var state = this.state,
                elems = this.inner.children,
                num = this.options.numElems;

            if (index !== this.lastIndex) {
                this.log('index change: ' + index);

                if (state.direction === -1) {
                    this.callbacks.becameInvisible(index - 1, elems[0]);
                    this.callbacks.becameVisible(index + num - 2, elems[num - 1]);
                } else {
                    this.callbacks.becameVisible(index, elems[0]);
                    this.callbacks.becameInvisible(index + num - 1, elems[num - 1]);
                }

                state.masterDirection = state.direction;
                state.swappedDirection = 0;
                this.lastIndex = index;
            }
        },

        detectMasterDirection: function () {
            var state = this.state;

            if (state.masterDirection === undefined || this.passedEdge() || this.lastState.masterDirection === undefined) {
                return state.direction;
            }

            return state.masterDirection;
        },

        calculateProgress: function () {
            var width = this.options.colWidth,
                progress = Math.abs(this.state.position) % width / width;

            if ((this.state.position > 0 ? this.state.masterDirection === -1 : this.state.masterDirection === 1)) {
                progress = 1 - progress;
            }

            return Math.round(progress * 100) / 100;
        },

        passedEdge: function () {
            return this.state.currentIndex !== this.lastState.currentIndex;
        },

        passedMultipleKeypoints: function () {
            var state = this.state,
                lastState = this.lastState,
                granularity = this.options.colWidth / 2,
                start = Math.floor(lastState.position / granularity) * granularity,
                end = Math.floor(state.position / granularity) * granularity;

            return Math.abs(end - start) / granularity > 1;
        },

        onEdge: function () {
            return this.state.position % this.options.colWidth === 0;
        },

        swappable: function () {
            var state = this.state;

            //do normal swap
            if (state.progress >= 0.5 && state.progress < 1 && state.swappedDirection === 0) {
                return true;
            }

            //swap back (user returned after hitting the middle)
            return state.progress < 0.5 && state.swappedDirection !== 0 && state.swappedDirection !== state.direction;
        },

        doSwap: function (index) {
            if (this.state.direction === 1) {
                this.swapLastFirst(index);
            } else {
                this.swapFirstLast(index);
            }
        },

        //move last element at the beginning
        swapLastFirst: function (index) {
            var elem = this.inner.children[this.inner.childElementCount - 1];

            this.log('swap last => first in index: ' + index);

            this.inner.insertBefore(elem, this.inner.children[0]);
            this.state.swappedDirection = 1;
            this.updateSwapOffset();
            this.callbacks.destroyElement(index + this.options.numElems - 1, elem);
            this.callbacks.createElement(index - 1, elem);
        },

        //move first element at the end
        swapFirstLast: function (index) {
            var elem = this.inner.children[0];

            this.log('swap first => last in index: ' + index);

            this.inner.appendChild(this.inner.children[0]);
            this.state.swappedDirection = -1;
            this.updateSwapOffset();
            this.callbacks.destroyElement(index - 1, elem);
            this.callbacks.createElement(index + this.options.numElems - 1, elem);
        },

        //the scrolling stopped, hide the unnecessary visible element
        stopped: function () {
            clearTimeout(this.onEdgeTimeout);

            this.started = false;
            this.callbacks.stopped();
        },

        //obtain "normalized" value of x
        getPositionFromScrollerValue: function (left) {
            return - (parseInt(left, 10) - this.offsetValue);
        },

        //make the browser transformation to actually move the elements
        setPosition: function (position) {
            this.inner.style['-webkit-transform'] = 'translate3d(' + (position - this.options.colWidth + this.swapOffset) + 'px, 0px, 0) scale(1)';
        },

        //change offset for shifting the whole container when swapping
        updateSwapOffset: function () {
            this.swapOffset = (this.state.currentIndex + (this.state.direction === 1 ? 0 : 1)) * this.options.colWidth;
        },

        scrollTo: function (index, animate) {
            if (animate === undefined) {
                animate = true;
            }

            if (animate) {
                this.scroller.scrollTo(this.offsetValue + index * this.options.colWidth, 0, true, 1);
            }
        },

        executeKeyPointsInSequence: function () {
            var state = this.state,
                lastState = this.lastState,
                granularity = this.options.colWidth / 2,
                start = this.getKeyPointFromPosition(lastState.position),
                end = this.getKeyPointFromPosition(state.position),
                i;

            if (state.direction === 1 && start !== lastState.position) {
                if (start < 0) {
                    start += granularity;
                }

                if (end >= 0) {
                    end -= granularity;
                }
            }

            if (lastState.direction === -1) {
                if (start >= 0) {
                    start -= granularity;
                }

                if (end < 0) {
                    end += granularity;
                }
            }

            this.log('Fast fw coords: ', lastState.position, state.position, start, end);

            if (state.direction === -1) {
                for (i = start;i >= end;i -= granularity) {
                    this.update(i, true);
                }
            } else {
                for (i = start;i <= end;i += granularity) {
                    this.update(i + (i % (granularity * 2) === 0 ? 1 : 0), true);
                }
            }
        },

        getKeyPointFromPosition: function (position) {
            var granularity = this.options.colWidth / 2,
                keypoint = Math.ceil(Math.abs(position) / granularity) * granularity;

            keypoint *= position < 0 ? -1 : 1;

            return keypoint;
        },

        //execute code once the scroller has stopped
        //instant execution if already stopped
        executeWhenStopped: function (func) {
            var self = this;

            return (function _() {
                if (!self.started) {
                    func.call(self);
                } else {
                    setTimeout(_, 1);
                }
            })();
        },

        //create event handlers
        attachEvents: function () {
            var scroller = this.scroller,
                elem = this.elem,
                events = {
                    'touchstart': {name: 'doTouchStart', touches: true},
                    'touchend': {name: 'doTouchEnd', touches: false},
                    'touchcancel': {name: 'doTouchEnd', touches: false},
                    'touchmove': {name: 'doTouchMove', touches: true}
                },

                handlerFunc = function (handlerName, includeTouches) {
                    return function (e) {
                        var args = [e.timeStamp];

                        if (includeTouches) {
                            args.unshift(e.changedTouches);
                        }

                        scroller[handlerName].apply(scroller, args);
                        e.stopPropagation();
                        e.preventDefault();
                    };
                },
                eventName,
                handler;

            for (eventName in events) {
                if (events.hasOwnProperty(eventName)) {
                    handler = handlerFunc(events[eventName]['name'], events[eventName]['touches']);
                    elem.addEventListener(eventName, handler, false);
                    this.attachedEvents[eventName] = handler;
                }
            }
        },

        //remove event handlers
        detachEvents: function () {
            var elem = this.elem,
                event;

            for (event in this.attachedEvents) {
                if (this.attachedEvents.hasOwnProperty(event)) {
                    elem.removeEventListener(event, this.attachedEvents[event]);
                }
            }
        },

        //define callback handlers
        callbacks: {
            _: function (func) {
                self.log('callback ' + func + '(' + Array.prototype.join.call(Array.prototype.slice.call(arguments, 1), ', ') + ')');
                if (self.options.callbacks[func] !== undefined) {
                    return self.options.callbacks[func].apply(self, Array.prototype.slice.call(arguments, 1));
                }
            },
            createElement: function (i, elem) {
                return self.callbacks._('createElement', i, elem);
            },
            destroyElement: function (i, elem) {
                return self.callbacks._('destroyElement', i, elem);
            },
            becameVisible: function (i, elem) {
                return self.callbacks._('becameVisible', i, elem);
            },
            becameInvisible: function (i, elem) {
                return self.callbacks._('becameInvisible', i, elem);
            },
            started: function () {
                return self.callbacks._('started');
            },
            stopped: function () {
                return self.callbacks._('stopped');
            },
            publishCurrentState: function () {
                var i,
                    state = self.state,
                    elems = self.inner.children;

                //trigger creation for first elements
                for (i = -1;i < self.options.numElems - 1;i += 1) {
                    self.callbacks.createElement(state.currentIndex + i, elems[i + 1]);
                }

                //trigger visibility for first elements
                self.callbacks.becameInvisible(state.currentIndex - 1, elems[0]);

                for (i = 0;i < self.options.numElems - 1;i += 1) {
                    self.callbacks.becameVisible(state.currentIndex + i, elems[i + 1]);
                }
            }
        },

        copyObject: function (source, destination) {
            for (var i in source) {
                if (source.hasOwnProperty(i)) {
                    destination[i] = source[i];
                }
            }
        },

        log: function () {
            if (this.options.debug) {
                console.log.apply(console, arguments);
            }
        }
    };

    window.InfiniteScroller = function InfiniteScroller() {
        return (function (elem, options) {
            this.elem = elem;

            for (var key in options) {
                if (options.hasOwnProperty(key)) {
                    this.options[key] = options[key];
                }
            }

            return this.init();
        }).apply(self, arguments);
    };
})();