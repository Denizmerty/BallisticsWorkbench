export class RequestGeneration {
    private current = 0;

    begin() {
        this.current += 1;
        return this.current;
    }

    isCurrent(generation: number) {
        return generation === this.current;
    }
}
