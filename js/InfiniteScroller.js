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
            createElement: function () {},
            destroyElement: function () {},
            becameVisible: function () {},
            becameInvisible: function () {}
        },

        lastPosition: null,

        lastProgress: null,

        lastCurrentIndex: null,

        offsetValue: null,

        swapOffset: 0,

        state: {
            direction: undefined,
            masterDirection: 0,
            swappedDirection: 0,
            currentIndex: 0,
            progress: 0
        },

        ignore: false,

        //executed once when the scroller is initialized
        init: function () {
            //container for the elements
            this.inner = this.elem.children[0];

            //zynga scroller init
            this.scroller = new Scroller(function () {
                self.update.apply(self, arguments);
            }, {
                scrollingX: true,
                scrollingY: false,
                snapping: true
            });

            //calculate offset from the actual (HUGE) position
            this.offsetValue = parseInt(this.options.innerOffsetNr * this.options.colWidth / 2, 10);

            //get css property
            var getStyleIntValue = function (elem, property) {
                return parseInt(window.getComputedStyle(elem, null).getPropertyValue(property), 10);
            };

            //setup zynga scroller
            this.ignore = true;
            this.scroller.setDimensions(getStyleIntValue(this.elem, 'width'), getStyleIntValue(this.elem, 'height'), this.options.innerOffsetNr * this.options.colWidth, getStyleIntValue(this.inner, 'height'));
            this.scroller.setSnapSize(this.options.colWidth, 0);
            this.ignore = false;

            //go to elem 1
            this.scroller.scrollBy(this.offset(this.options.colWidth), 0, false);
            this.state.masterDirection = 0;

            //attach events for touch
            this.attachTouchEvents();
        },

        //executed for every move event
        update: function (left) {
            var position = -parseInt(left, 10), //invert position from zynga
                normalized = this.offset(position), //get actual "relative" position
                state = this.state,
                width = this.options.colWidth;

            if (!this.ignore && this.lastPosition !== normalized) { //only execute if needed
                //instantaneous direction
                state.direction = normalized === this.lastPosition ? 0 : normalized < this.lastPosition ? -1 : 1;
                state.currentIndex = -Math.ceil(normalized / width) - 1;

                //cell direction
                if (state.masterDirection === 0) {
                    state.masterDirection = state.direction;
                }

                //calculate progress in current element
                state.progress = Math.abs(normalized >= 0 ? this.options.colWidth - normalized : -normalized) % width / width;

                if (state.masterDirection !== -1) {
                    state.progress = 1 - state.progress;
                }

                state.progress = parseFloat(state.progress.toFixed(2));

                //swap
                if (this.needsSwapping() && !this.passedEdge()) {
                    this.executeBetweenIndexes(this['swap' + (state.direction === 1 ? 'LastFirst' : 'FirstLast')], 1);
                }

                //hit edge (forward or backwards)
                if (this.passedEdge()) {
                    this.executeBetweenIndexes(this.executeEdgePass);
                }

                //move the container
                this.setPosition(normalized);
                this.lastPosition = normalized;
                this.lastProgress = state.progress;
                this.lastCurrentIndex = state.currentIndex;

                //console.log(state, normalized, state.progress);
            }
        },

        //execute a function for as many times as currentIndex - lastIndex + additionalExecutions
        //for situations where the scroll happened so fast that elements have been skipped
        executeBetweenIndexes: function (func, additionalExecutions) {
            var i;

            if (additionalExecutions === undefined) {
                additionalExecutions = 0;
            }

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
            return this.lastCurrentIndex !== null && (this.state.currentIndex !== this.lastCurrentIndex || this.state.progress === 1);
        },

        //do stuff when an edge is passed by
        executeEdgePass: function (index) {
            var state = this.state;

            //console.log('edge');
            state.masterDirection = 0;//state.progress != 1 ? state.direction : state.masterDirection;
            state.swappedDirection = 0;

            if (state.progress === 1) {
                state.progress = 0;
            }

            this.options.becameVisible(index + this.options.numElems - 1);
            this.options.becameInvisible(index);
        },

        //move last element at the beginning
        swapLastFirst: function () {
            this.inner.insertBefore(this.inner.children[this.inner.childElementCount - 1], this.inner.children[0]);
            this.state.swappedDirection = 1;
            this.updateSwapOffset();
            this.options.createElement(this.state.currentIndex - 1);
            this.options.destroyElement(this.state.currentIndex + this.options.numElems - 1);
        },

        //move first element at the end
        swapFirstLast: function () {
            this.inner.appendChild(this.inner.children[0]);
            this.state.swappedDirection = -1;
            this.updateSwapOffset();
            this.options.createElement(this.state.currentIndex + this.options.numElems - 1);
            this.options.destroyElement(this.state.currentIndex - 1);
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
            this.inner.style['-webkit-transform'] = 'translateX(' + (position + this.swapOffset) + 'px)';
        },

        //create event handlers
        attachTouchEvents: function () {
            var scroller = this.scroller,
                elem = this.elem;

            elem.addEventListener('touchstart', function (e) {
                scroller.doTouchStart(e.changedTouches, e.timeStamp);
            }, false);

            elem.addEventListener('touchend', function (e) {
                scroller.doTouchEnd(e.timeStamp);
            }, false);

            elem.addEventListener('touchcancel', function (e) {
                scroller.doTouchEnd(e.timeStamp);
            }, false);

            elem.addEventListener('touchmove', function (e) {
                scroller.doTouchMove(e.changedTouches, e.timeStamp);
            }, false);
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