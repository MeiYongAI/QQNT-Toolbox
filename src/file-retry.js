'use strict';

const PRESERVE_KIND = 'preserve';

function isPreservedElement(element) {
    const elementType = Number(element?.elementType);
    return elementType === 1 ||
        elementType === 7 ||
        Boolean(element?.textElement) ||
        Boolean(element?.replyElement);
}

function createFileRetryPlan(elements, describeRepair, isGeneratedPath, config = {}) {
    if (!Array.isArray(elements) || !elements.length) {
        return null;
    }
    const plan = [];
    let repairCount = 0;
    for (const element of elements) {
        const descriptor = describeRepair(element);
        if (!descriptor) {
            if (!isPreservedElement(element)) {
                return null;
            }
            plan.push({ kind: PRESERVE_KIND, element });
            continue;
        }
        if (isGeneratedPath(descriptor.sourcePath) || config[descriptor.kind] === false) {
            return null;
        }
        if (descriptor.kind === 'otherFiles' && !String(config.archivePassword || '')) {
            return null;
        }
        plan.push(descriptor);
        repairCount += 1;
    }
    return repairCount > 0 ? plan : null;
}

function getRepairKinds(plan) {
    return (Array.isArray(plan) ? plan : [])
        .filter(descriptor => descriptor?.kind && descriptor.kind !== PRESERVE_KIND)
        .map(descriptor => descriptor.kind);
}

module.exports = {
    PRESERVE_KIND,
    createFileRetryPlan,
    getRepairKinds,
    isPreservedElement
};
