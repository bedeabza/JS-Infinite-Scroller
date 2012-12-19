(function () {
    'use strict';

    var self = {
        elem: null,     //panel element (scroll window)
        inner: null,    //moving element (first child of the scroll window)
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

        //executed once when the scroller is initialized
        init: function () {
            var i;

            //container for the elements
            this.inner = this.elem.children[0];

            //zynga scroller init
            this.initScroller(true);

            //go to elem 1
            this.scroller.scrollBy(this.offset(this.options.colWidth), 0, false);

            //trigger creation for first elements
            for (i = -1;i < this.options.numElems - 1;i += 1) {
                this.callbacks.createElement(i, this.inner.children[i + 1]);
            }

            //trigger visibility for first elements
            for (i = 0;i < this.options.numElems - 2;i += 1) {
                this.callbacks.becameVisible(i, this.inner.children[i + 1]);
            }

            return this;
        },

        initScroller: function (firstTime) {
            var getStyleIntValue;

            this.scroller = new Scroller(function () {
                self.update.apply(self, arguments);
            }, {
                scrollingX: true,
                scrollingY: false,
                snapping: true,
                bouncing: false,
                speedMultiplier: this.options.speedMultiplier
            });

            //calculate offset from the actual (HUGE) position
            if (!this.offsetValue) {
                this.offsetValue = parseInt(this.options.innerOffsetNr * this.options.colWidth / 2, 10);
            }

            //get css property
            getStyleIntValue = function (elem, property) {
                return parseInt(window.getComputedStyle(elem, null).getPropertyValue(property), 10);
            };

            //setup zynga scroller
            this.ignore = true;
            this.scroller.setDimensions(getStyleIntValue(this.elem, 'width'), getStyleIntValue(this.elem, 'height'), this.options.innerOffsetNr * this.options.colWidth, getStyleIntValue(this.inner, 'height'));
            this.scroller.setSnapSize(this.options.colWidth, 0);

            if (!firstTime) {
                this.scroller.scrollTo(this.offsetValue - this.state.position, 0, false, 1);
            }

            this.ignore = false;

            //attach events for touch
            this.detachEvents();
            this.attachEvents();
        },

        //executed for every move event
        update: function (left) {
            var position = -parseInt(left, 10), //invert position from zynga
                normalized = this.offset(position), //get actual "relative" position
                state = this.state,
                width = this.options.colWidth,
                absoluteProgress,
                i;

            if (!this.ignore && this.lastState.position !== normalized) { //only execute if needed
                //start callback
                if (this.started === false) {
                    this.started = true;
                    this.callbacks.started();
                }

                state.position = normalized;

                //instantaneous direction
                state.direction = normalized === this.lastState.position ? 0 : normalized < this.lastState.position ? -1 : 1;
                state.currentIndex = -Math.ceil(normalized / width) - 1;

                //cell direction
                if (state.masterDirection === undefined || this.passedEdge()) {
                    state.masterDirection = state.direction;
                }

                //calculate progress in current element
                absoluteProgress = Math.abs(normalized) % width / width;
                state.progress = this.complementAbsoluteProgress() ? 1 - absoluteProgress : absoluteProgress;

                state.progress = parseFloat(state.progress.toFixed(2));

                //hit edge (forward or backwards)
                if (this.passedEdge()) {
                    this.executeBetweenIndexes(this.executeEdgePass);
                    this.passedEdgeLastTime = true;
                } else {
                    this.passedEdgeLastTime = false;
                }

                //swap
                if (this.needsSwapping() || this.swapAlongWithEdge()) {
                    this.executeBetweenIndexes(this['swap' + (state.direction === 1 ? 'LastFirst' : 'FirstLast')]);
                }

                //set timeout for stopping the scroll
                if (this.onEdgeTimeout !== null) {
                    clearTimeout(this.onEdgeTimeout);
                }

                this.onEdgeTimeout = setTimeout(function () {
                    self.stopped.call(self);
                }, 200);

                //move the container
                this.setPosition(normalized);
                this.swappedAlongWithEdge = this.swapAlongWithEdge();

                //copy state in lastState
                for (i in state) {
                    if (state.hasOwnProperty(i)) {
                        this.lastState[i] = state[i];
                    }
                }

                //log state
                this.log(state, 'x: ' + normalized);
            }
        },

        complementAbsoluteProgress: function () {
            return this.state.position > 0 ? this.state.masterDirection === -1 : this.state.masterDirection === 1;
        },

        //execute a function for as many times as currentIndex - lastIndex + additionalExecutions
        //for situations where the scroll happened so fast that elements have been skipped
        executeBetweenIndexes: function (func) {
            var i,
                additionalExecutions = (this.state.currentIndex === this.lastState.currentIndex ? 1 : 0);

            if (this.state.direction === -1) {
                for (i = this.lastState.currentIndex;i < this.state.currentIndex + additionalExecutions;i += 1) {
                    func.call(this, i);
                }
            } else {
                for (i = this.lastState.currentIndex;i > this.state.currentIndex - additionalExecutions;i -= 1) {
                    func.call(this, i);
                }
            }
        },

        //check if swap is needed
        needsSwapping: function () {
            var state = this.state;

            //do normal swap
            if (state.progress >= 0.5 && state.progress < 1 && state.swappedDirection === 0) {
                return true;
            }

            //swap back (user returned after hitting the middle)
            if (state.progress < 0.5 && state.swappedDirection !== 0 && state.swappedDirection !== state.direction) {
                return true;
            }

            return false;
        },

        //check if at least an edge has been passed by
        passedEdge: function () {
            return (this.lastState.currentIndex !== undefined && this.state.currentIndex !== this.lastState.currentIndex) ||
                this.state.progress === 1 ||
                this.state.progress === 0 ||
                ((this.lastState.progress === 0 || this.lastState.progress === 1) && this.passedEdgeLastTime);
        },

        //check if more than 1 edge passed
        //or if swap is needed even if the edge has been passed
        swapAlongWithEdge: function () {
            return (this.lastState.currentIndex !== undefined) && (
                (this.state.currentIndex > this.lastState.currentIndex + 1) ||
                    (this.state.currentIndex < this.lastState.currentIndex - 1)
                );
        },

        //do stuff when an edge is passed by
        executeEdgePass: function (index) {
            var state = this.state;

            this.log('passed edge');

            state.masterDirection = state.direction;
            state.swappedDirection = 0;

            if (state.progress === 1) {
                state.progress = 0;
            }

            this.callbacks.becameVisible(index + (state.direction === 1 ? 0 : this.options.numElems) - 2, this.inner.children[state.direction === 1 ? 0 : this.inner.childElementCount - 1]);
            this.callbacks.becameInvisible(index + (state.direction === -1 ? 0 : this.options.numElems - 2), this.inner.children[state.direction === -1 ? 0 : this.inner.childElementCount - 1]);
        },

        //move last element at the beginning
        swapLastFirst: function () {
            var elem = this.inner.children[this.inner.childElementCount - 1];

            this.log('swap last => first');

            this.inner.insertBefore(elem, this.inner.children[0]);
            this.state.swappedDirection = 1;
            this.updateSwapOffset();
            this.callbacks.destroyElement(this.state.currentIndex + this.options.numElems - 1, elem);
            this.callbacks.createElement(this.state.currentIndex - 1, elem);
        },

        //move first element at the end
        swapFirstLast: function () {
            var elem = this.inner.children[0];

            this.log('swap first => last');

            this.inner.appendChild(this.inner.children[0]);
            this.state.swappedDirection = -1;
            this.updateSwapOffset();
            this.callbacks.destroyElement(this.state.currentIndex - 1, elem);
            this.callbacks.createElement(this.state.currentIndex + this.options.numElems - 1, elem);
        },

        //the scrolling stopped, hide the unnecessary visible element
        stopped: function () {
            var index, elem;

            clearTimeout(this.onEdgeTimeout);

            if (this.lastState.masterDirection === -1) {
                index = this.state.currentIndex + this.options.numElems - 2;
                elem = this.inner.children[this.inner.childElementCount - 1];
            } else {
                index = this.state.currentIndex - 1;
                elem = this.inner.children[0];
            }

            this.started = false;

            this.callbacks.becameInvisible(index, elem);
            this.callbacks.stopped();
        },

        //change offset for shifting the whole container when swapping
        updateSwapOffset: function () {
            this.swapOffset = (this.state.currentIndex + (this.state.direction === 1 ? 0 : 1)) * this.options.colWidth;
        },

        //obtain "normalized" value of x
        offset: function (left) {
            return left + this.offsetValue;
        },

        //make the browser transformation to actually move the elements
        setPosition: function (position) {
            this.inner.style['-webkit-transform'] = 'translate3d(' + (position + this.swapOffset) + 'px, 0px, 0) scale(1)';
        },

        //execute code once the scroller has stopped
        //instant execution if already stopped
        executeWhenStopped: function (func) {
            var self = this;

            return (function () {
                if (!self.started) {
                    func.call(self);
                } else {
                    setTimeout(function _() {
                        if (!self.started) {
                            func.call(self);
                        } else {
                            setTimeout(_, 1);
                        }
                    }, 1);
                }
            })();
        },

        //externally change the width of the elements
        setColWidth: function (width) {
            this.executeWhenStopped(function () {
                var diff = width - this.options.colWidth,
                    newPosition = this.state.position - diff;

                this.options.colWidth = width;
                this.state.position = newPosition;
                this.setPosition(newPosition);

                this.initScroller(false);
            });
        },

        //externally change the number of elements
        setNumElems: function (num) {
            this.options.numElems = num;
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