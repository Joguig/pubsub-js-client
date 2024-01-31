
all:: build

SRC_DIR=src
DIST_DIR=dist
JSHINT=./node_modules/jshint/bin/jshint
JSCS=./node_modules/jscs/bin/jscs
BROCCOLI=./node_modules/broccoli-cli/bin/broccoli
PUBLISH=./scripts/publish

clean:
	@rm -rf ${DIST_DIR}

setup:
	npm install

lint:
	${JSHINT} ${SRC_DIR}
	${JSCS} ${SRC_DIR}

build: clean setup lint
	${BROCCOLI} build ${DIST_DIR}

release: build
