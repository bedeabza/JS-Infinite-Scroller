var InfiniteScroller = (function(){
    var self = {
        elem: null,

        inner: null,

        scroller: null,

        options: {
            colWidth: null,
            numElems: null,
            innerOffsetNr: 1000
        },

        lastPosition: null,

        lastProgress: null,

        offsetValue: null,

        swapOffset: 0,

        state: {
            direction: 0,
            masterDirection: 0,
            swappedDirection: 0,
            currentIndex: 0,
            progress: 0
        },

        ignore: false,

        init: function() {
            //container for the elements
            this.inner = this.elem.children[0];

            //zynga scroller init
            this.scroller = new Scroller(function(){
                self.update.apply(self, arguments);
            }, {
                scrollingX: true,
                scrollingY: false,
                snapping: true
            });

            //calculate offset from the actual (HUGE) position
            this.offsetValue = parseInt(this.options.innerOffsetNr*this.options.colWidth/2, 10);

            //get css property
            var getStyleIntValue = function(elem, property) {
                return parseInt(window.getComputedStyle(elem, null).getPropertyValue(property), 10);
            };

            //setup zynga scroller
            this.ignore = true;
            this.scroller.setDimensions(getStyleIntValue(this.elem, 'width'), getStyleIntValue(this.elem, 'height'), this.options.innerOffsetNr*this.options.colWidth, getStyleIntValue(this.inner, 'height'));
            this.scroller.setSnapSize(this.options.colWidth, 0);
            this.ignore = false;

            //go to elem 1
            this.scroller.scrollBy(this.offset(this.options.colWidth), 0, false);

            //attach events for touch
            this.attachTouchEvents();
        },

        update: function(left, top, zoom) {
            var position = -parseInt(left, 10); //invert position from zynga
            var normalized = this.offset(position); //get actual "relative" position
            var state = this.state;
            var width = this.options.colWidth;

            if (!this.ignore && this.lastPosition != normalized){ //only execute if needed
                //instantaneous direction
                state.direction = normalized == this.lastPosition ? 0 : normalized < this.lastPosition ? -1 : 1;
                state.currentIndex = -Math.ceil(normalized/width) - 1;

                //cell direction
                if (state.masterDirection == 0) {
                    state.masterDirection = state.direction;
                }

                //calculate progress in current element
                state.progress = Math.abs(-normalized % width / width);

                if (state.masterDirection == 1) {
                    state.progress = 1-state.progress;
                }

                state.progress = parseFloat(state.progress.toFixed(2));

                //swap
                if (this.needsSwapping()) {
                    console.log('swap');
                    this['swap' + (state.direction == 1 ? 'LastFirst' : 'FirstLast')].apply(this, []);
                }

                //hit edge (forward or backwards)
                if (this.passedEdge()) {
                    console.log('edge');
                    state.swappedDirection = 0;
                    state.masterDirection = state.direction;
                }

                //move the container
                this.setPosition(normalized);
                this.lastPosition = normalized;
                this.lastProgress = state.progress;

                console.log(state, normalized, state.progress);
            }
        },

        needsSwapping: function() {
            var state = this.state;

            //do normal swap
            if (state.progress >= 0.5 && state.swappedDirection === 0) {
                return true;
            }

            //swap back (user returned after hitting the middle)
            if (state.progress < 0.5 && state.swappedDirection !== 0 && state.swappedDirection !== state.direction) {
                return true;
            }

            return false;
        },

        passedEdge: function() {
            return this.state.progress < 0.2 && this.lastProgress > 0.8;
        },

        swapLastFirst: function() {
            //move first element at the end
            this.inner.insertBefore(this.inner.children[this.inner.childElementCount-1], this.inner.children[0]);
            this.state.swappedDirection = 1;
            this.setSwapOffset(-this.options.colWidth);
        },

        swapFirstLast: function() {
            //move last element at the beginning
            this.inner.appendChild(this.inner.children[0]);
            this.state.swappedDirection = -1;
            this.setSwapOffset(this.options.colWidth);
        },

        setSwapOffset: function (val) {
            this.swapOffset = (this.state.currentIndex+1)*this.options.colWidth;
            console.log(this.swapOffset);
        },

        offset: function(left) {
            return left + this.offsetValue;
        },

        setPosition: function(position) {
            this.inner.style['-webkit-transform'] = 'translateX(' + (position + this.swapOffset) + 'px)';
        },

        attachTouchEvents: function() {
            var scroller = this.scroller;
            var elem = this.elem;

            elem.addEventListener('touchstart', function(e){
                scroller.doTouchStart(e.changedTouches, e.timeStamp);
            }, false);

            elem.addEventListener('touchend', function(e){
                scroller.doTouchEnd(e.timeStamp);
            }, false);

            elem.addEventListener('touchcancel', function(e){
                scroller.doTouchEnd(e.timeStamp);
            }, false);

            elem.addEventListener('touchmove', function(e){
                scroller.doTouchMove(e.changedTouches, e.timeStamp);
            }, false);
        }
    };

    return function(){
        return (function(elem, options) {
            this.elem = elem;

            for (var key in options) {
                this.options[key] = options[key];
            }

            this.init();
        }).apply(self, arguments);
    };
})();