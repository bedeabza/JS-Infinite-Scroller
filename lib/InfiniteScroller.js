(function () {
    'use strict';
    var self = {
        elem: null,

        inner: null,

        scroller: null,

        options: {
            colWidth: null,
            numElems: null,
            innerOffsetNr: 1000,
            speedMultiplier: 1,
            debug: false,
            callbacks: {
                createElement: undefined,
                destroyElement: undefined,
                becameVisible: undefined,
                becameInvisible: undefined,
                started: undefined,
                stopped: undefined
            }
        },

        lastPosition: null,

        lastProgress: null,

        lastCurrentIndex: null,

        lastMasterDirection: null,

        passedEdgeLastTime: false,

        offsetValue: null,

        swapOffset: 0,

        state: {
            direction: undefined,
            masterDirection: undefined,
            swappedDirection: 0,
            currentIndex: 0,
            progress: 0
        },

        ignore: false,

        hitEdgeLastTime: false,

        onEdgeTimeout: null,

        started: false,

        //executed once when the scroller is initialized
        init: function () {
            var getStyleIntValue, i;

            //container for the elements
            this.inner = this.elem.children[0];

            //zynga scroller init
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
            this.offsetValue = parseInt(this.options.innerOffsetNr * this.options.colWidth / 2, 10);

            //get css property
            getStyleIntValue = function (elem, property) {
                return parseInt(window.getComputedStyle(elem, null).getPropertyValue(property), 10);
            };

            //setup zynga scroller
            this.ignore = true;
            this.scroller.setDimensions(getStyleIntValue(this.elem, 'width'), getStyleIntValue(this.elem, 'height'), this.options.innerOffsetNr * this.options.colWidth, getStyleIntValue(this.inner, 'height'));
            this.scroller.setSnapSize(this.options.colWidth, 0);
            this.ignore = false;

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

            //attach events for touch
            this.attachTouchEvents();
        },

        //executed for every move event
        update: function (left) {
            var position = -parseInt(left, 10), //invert position from zynga
                normalized = this.offset(position), //get actual "relative" position
                state = this.state,
                width = this.options.colWidth,
                absoluteProgress;

            if (!this.ignore && this.lastPosition !== normalized) { //only execute if needed
                //start callback
                if (this.started === false) {
                    this.started = true;
                    this.callbacks.started();
                }

                //instantaneous direction
                state.direction = normalized === this.lastPosition ? 0 : normalized < this.lastPosition ? -1 : 1;
                state.currentIndex = -Math.ceil(normalized / width) - 1;

                //cell direction
                if (state.masterDirection === undefined || this.passedEdge()) {
                    state.masterDirection = state.direction;
                }

                //calculate progress in current element
                absoluteProgress = Math.abs(normalized) % width / width;
                state.progress = state.masterDirection === -1 ? absoluteProgress : 1 - absoluteProgress;

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
                this.lastPosition = normalized;
                this.lastProgress = state.progress;
                this.lastCurrentIndex = state.currentIndex;
                this.lastMasterDirection = state.masterDirection;

                this.log(state, 'X: ' + normalized);
            }
        },

        //execute a function for as many times as currentIndex - lastIndex + additionalExecutions
        //for situations where the scroll happened so fast that elements have been skipped
        executeBetweenIndexes: function (func) {
            var i,
                additionalExecutions = (this.state.currentIndex === this.lastCurrentIndex ? 1 : 0);

            if (this.state.direction === -1) {
                for (i = this.lastCurrentIndex;i < this.state.currentIndex + additionalExecutions;i += 1) {
                    func.call(this, i);
                }
            } else {
                for (i = this.lastCurrentIndex;i > this.state.currentIndex - additionalExecutions;i -= 1) {
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
            return (this.lastCurrentIndex !== null && this.state.currentIndex !== this.lastCurrentIndex) ||
                        this.state.progress === 1 ||
                        this.state.progress === 0 ||
                        ((this.lastProgress === 0 || this.lastProgress === 1) && this.passedEdgeLastTime);
        },

        //check if more than 1 edge passed
        //or if swap is needed even if the edge has been passed
        swapAlongWithEdge: function () {
            return (this.state.currentIndex > this.lastCurrentIndex + 1) ||
                    (this.state.currentIndex < this.lastCurrentIndex - 1);
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

            this.hitEdgeLastTime = true;

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

            if (this.lastMasterDirection === -1) {
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

        //create event handlers
        attachTouchEvents: function () {
            var scroller = this.scroller,
                elem = this.elem;

            elem.addEventListener('touchstart', function (e) {
                scroller.doTouchStart(e.changedTouches, e.timeStamp);
                e.stopPropagation();
                e.preventDefault();
            }, false);

            elem.addEventListener('touchend', function (e) {
                scroller.doTouchEnd(e.timeStamp);
                e.stopPropagation();
                e.preventDefault();
            }, false);

            elem.addEventListener('touchcancel', function (e) {
                scroller.doTouchEnd(e.timeStamp);
                e.stopPropagation();
                e.preventDefault();
            }, false);

            elem.addEventListener('touchmove', function (e) {
                scroller.doTouchMove(e.changedTouches, e.timeStamp);
                e.stopPropagation();
                e.preventDefault();
            }, false);
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

            this.init();
        }).apply(self, arguments);
    };
})();